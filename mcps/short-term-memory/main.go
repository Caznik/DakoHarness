package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

func main() {
	// Project root: the directory from which the agent is running.
	// Agents pass it via DAKO_PROJECT_ROOT env var; fall back to cwd.
	projectRoot := os.Getenv("DAKO_PROJECT_ROOT")
	if projectRoot == "" {
		var err error
		projectRoot, err = os.Getwd()
		if err != nil {
			fmt.Fprintf(os.Stderr, "cannot determine project root: %v\n", err)
			os.Exit(1)
		}
	}

	db, err := openDB(projectRoot)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open short-term memory db: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	fmt.Fprintf(os.Stderr, "Short-term memory ready — %s/.dako/patterns.db\n",
		filepath.Base(projectRoot))

	s := server.NewMCPServer(
		"dako-short-term-memory",
		"1.0.0",
		server.WithToolCapabilities(true),
	)

	registerTools(s, db)

	if err := server.ServeStdio(s); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}

func registerTools(s *server.MCPServer, db *sql.DB) {
	// ── remember_pattern ─────────────────────────────────────────────────────
	s.AddTool(
		mcp.NewTool("remember_pattern",
			mcp.WithDescription(`Saves an accepted pattern to short-term memory (7-day TTL).
Call this when the user approves an approach, a code pattern is established,
or a decision is made that should guide similar tasks in the near future.
This is NOT long-term memory — for permanent knowledge use the remember tool.`),
			mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
			mcp.WithString("agent", mcp.Required(), mcp.Description("Agent saving this pattern (e.g. 'claude-code')")),
			mcp.WithString("title", mcp.Required(), mcp.Description("Short title describing the pattern (one line)")),
			mcp.WithString("approach", mcp.Required(), mcp.Description("What was done and why the user accepted it — be specific")),
			mcp.WithString("context", mcp.Description("When to apply this pattern — what triggers it")),
			mcp.WithString("task_type", mcp.Description("Category: bug-fix | feature | refactor | config | convention | explanation")),
			mcp.WithString("tags", mcp.Description("Comma-separated keywords for search")),
			mcp.WithString("session_id", mcp.Description("Session where this pattern originated")),
		),
		func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			p := Pattern{
				Project:   stringArg(req, "project"),
				Agent:     stringArg(req, "agent"),
				Title:     stringArg(req, "title"),
				Approach:  stringArg(req, "approach"),
				Context:   stringArg(req, "context"),
				TaskType:  stringArg(req, "task_type"),
				Tags:      stringArg(req, "tags"),
				SessionID: stringArg(req, "session_id"),
			}

			id, err := savePattern(db, p)
			if err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("failed to save pattern: %v", err)), nil
			}

			return mcp.NewToolResultText(fmt.Sprintf(
				"Pattern saved (id: %s, expires in %d days): %q", id, ttlDays, p.Title,
			)), nil
		},
	)

	// ── find_patterns ────────────────────────────────────────────────────────
	s.AddTool(
		mcp.NewTool("find_patterns",
			mcp.WithDescription(`Full-text search across short-term patterns for a project.
Use before starting a task to find how similar work was handled recently.`),
			mcp.WithString("project", mcp.Required(), mcp.Description("Project to search within")),
			mcp.WithString("query", mcp.Required(), mcp.Description("Search terms matched against title, approach, context and tags")),
			mcp.WithString("limit", mcp.Description("Max results to return (default 5)")),
		),
		func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			project := stringArg(req, "project")
			query := stringArg(req, "query")
			limit := parseIntArg(req, "limit", 5)

			patterns, err := findPatterns(db, project, query, limit)
			if err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("search failed: %v", err)), nil
			}

			if len(patterns) == 0 {
				return mcp.NewToolResultText(fmt.Sprintf(
					`No recent patterns found for "%s" in project "%s".`, query, project,
				)), nil
			}

			return mcp.NewToolResultText(formatPatterns(patterns, project)), nil
		},
	)

	// ── get_recent_patterns ──────────────────────────────────────────────────
	s.AddTool(
		mcp.NewTool("get_recent_patterns",
			mcp.WithDescription(`Returns the most recent patterns for a project within the last N days.
Use at session start to load fresh context for the current project.`),
			mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
			mcp.WithString("days", mcp.Description("How many days back to look (default 7, max 7)")),
			mcp.WithString("limit", mcp.Description("Max results to return (default 20)")),
		),
		func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			project := stringArg(req, "project")
			days := parseIntArg(req, "days", ttlDays)
			if days > ttlDays {
				days = ttlDays
			}
			limit := parseIntArg(req, "limit", 20)

			patterns, err := getRecentPatterns(db, project, days, limit)
			if err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("query failed: %v", err)), nil
			}

			if len(patterns) == 0 {
				return mcp.NewToolResultText(fmt.Sprintf(
					`No patterns found for project "%s" in the last %d day(s).`, project, days,
				)), nil
			}

			return mcp.NewToolResultText(formatPatterns(patterns, project)), nil
		},
	)
}

// ── helpers ──────────────────────────────────────────────────────────────────

func args(req mcp.CallToolRequest) map[string]any {
	if m, ok := req.Params.Arguments.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func stringArg(req mcp.CallToolRequest, key string) string {
	if v, ok := args(req)[key]; ok && v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func parseIntArg(req mcp.CallToolRequest, key string, defaultVal int) int {
	v := stringArg(req, key)
	if v == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return defaultVal
	}
	return n
}

func formatPatterns(patterns []Pattern, project string) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "%d pattern(s) for \"%s\":\n\n", len(patterns), project)
	for _, p := range patterns {
		fmt.Fprintf(&sb, "[%s] %s\n", strings.ToUpper(p.TaskType), p.Title)
		fmt.Fprintf(&sb, "  Approach: %s\n", p.Approach)
		if p.Context != "" {
			fmt.Fprintf(&sb, "  When: %s\n", p.Context)
		}
		if p.Tags != "" {
			fmt.Fprintf(&sb, "  Tags: %s\n", p.Tags)
		}
		fmt.Fprintf(&sb, "  Saved by %s | expires %s\n", p.Agent, p.ExpiresAt.Format("2006-01-02"))
		fmt.Fprintln(&sb, "---")
	}
	return sb.String()
}
