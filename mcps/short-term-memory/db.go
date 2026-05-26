package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

const ttlDays = 7

const schema = `
CREATE TABLE IF NOT EXISTS patterns (
	id         TEXT PRIMARY KEY,
	project    TEXT NOT NULL,
	agent      TEXT NOT NULL,
	session_id TEXT NOT NULL DEFAULT '',
	task_type  TEXT NOT NULL DEFAULT '',
	title      TEXT NOT NULL,
	approach   TEXT NOT NULL,
	context    TEXT NOT NULL DEFAULT '',
	tags       TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS patterns_fts USING fts5(
	title, approach, context, tags,
	content=patterns,
	content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS patterns_ai AFTER INSERT ON patterns BEGIN
	INSERT INTO patterns_fts(rowid, title, approach, context, tags)
	VALUES (new.rowid, new.title, new.approach, new.context, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS patterns_ad AFTER DELETE ON patterns BEGIN
	INSERT INTO patterns_fts(patterns_fts, rowid, title, approach, context, tags)
	VALUES ('delete', old.rowid, old.title, old.approach, old.context, old.tags);
END;
`

type Pattern struct {
	ID        string
	Project   string
	Agent     string
	SessionID string
	TaskType  string
	Title     string
	Approach  string
	Context   string
	Tags      string
	CreatedAt time.Time
	ExpiresAt time.Time
}

// openDB resolves the .dako directory inside the project root, creates it if
// needed, opens (or creates) patterns.db, and runs schema migrations.
func openDB(projectRoot string) (*sql.DB, error) {
	dakoDir := filepath.Join(projectRoot, ".dako")
	if err := os.MkdirAll(dakoDir, 0755); err != nil {
		return nil, fmt.Errorf("create .dako dir: %w", err)
	}

	dbPath := filepath.Join(dakoDir, "patterns.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("apply schema: %w", err)
	}

	if err := deleteExpired(db); err != nil {
		return nil, fmt.Errorf("ttl cleanup: %w", err)
	}

	return db, nil
}

// deleteExpired removes all patterns past their expires_at timestamp.
func deleteExpired(db *sql.DB) error {
	_, err := db.Exec(`DELETE FROM patterns WHERE expires_at < ?`, time.Now().UTC().Format(time.RFC3339))
	return err
}

// savePattern inserts a new pattern and returns its ID.
func savePattern(db *sql.DB, p Pattern) (string, error) {
	p.ID = uuid.NewString()
	p.CreatedAt = time.Now().UTC()
	p.ExpiresAt = p.CreatedAt.Add(ttlDays * 24 * time.Hour)

	_, err := db.Exec(`
		INSERT INTO patterns (id, project, agent, session_id, task_type, title, approach, context, tags, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Project, p.Agent, p.SessionID, p.TaskType,
		p.Title, p.Approach, p.Context, p.Tags,
		p.CreatedAt.Format(time.RFC3339),
		p.ExpiresAt.Format(time.RFC3339),
	)
	if err != nil {
		return "", err
	}
	return p.ID, nil
}

// sanitizeFTSQuery replaces FTS5 special characters with spaces so that
// queries like "context-snapshot" don't get parsed as boolean expressions.
func sanitizeFTSQuery(q string) string {
	var b strings.Builder
	for _, r := range q {
		switch r {
		case '-', '"', '*', '^', ':', '(', ')':
			b.WriteRune(' ')
		default:
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// findPatterns runs an FTS5 query against the patterns for a project.
func findPatterns(db *sql.DB, project, query string, limit int) ([]Pattern, error) {
	rows, err := db.Query(`
		SELECT p.id, p.project, p.agent, p.session_id, p.task_type,
		       p.title, p.approach, p.context, p.tags, p.created_at, p.expires_at
		FROM patterns p
		JOIN patterns_fts f ON p.rowid = f.rowid
		WHERE f.patterns_fts MATCH ? AND p.project = ? AND p.expires_at >= ?
		ORDER BY rank
		LIMIT ?`,
		sanitizeFTSQuery(query), project, time.Now().UTC().Format(time.RFC3339), limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPatterns(rows)
}

// getRecentPatterns returns the most recent patterns for a project within the TTL window.
func getRecentPatterns(db *sql.DB, project string, days, limit int) ([]Pattern, error) {
	since := time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour).Format(time.RFC3339)
	rows, err := db.Query(`
		SELECT id, project, agent, session_id, task_type,
		       title, approach, context, tags, created_at, expires_at
		FROM patterns
		WHERE project = ? AND created_at >= ? AND expires_at >= ?
		ORDER BY created_at DESC
		LIMIT ?`,
		project, since, time.Now().UTC().Format(time.RFC3339), limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPatterns(rows)
}

func scanPatterns(rows *sql.Rows) ([]Pattern, error) {
	var patterns []Pattern
	for rows.Next() {
		var p Pattern
		var createdStr, expiresStr string
		if err := rows.Scan(
			&p.ID, &p.Project, &p.Agent, &p.SessionID, &p.TaskType,
			&p.Title, &p.Approach, &p.Context, &p.Tags,
			&createdStr, &expiresStr,
		); err != nil {
			return nil, err
		}
		p.CreatedAt, _ = time.Parse(time.RFC3339, createdStr)
		p.ExpiresAt, _ = time.Parse(time.RFC3339, expiresStr)
		patterns = append(patterns, p)
	}
	return patterns, rows.Err()
}
