---
tags: [dakoharness, architecture]
created: 2026-05-20
---

# Architecture

## Component map

```
DakoHarness/
├── mcps/
│   ├── mongodb-memory/         Long-term memory MCP (Node.js + TypeScript)
│   │   ├── server.ts           MCP server (remember, recall, get_context, promote_to_team,
│   │   │                         forget, archive_workitem, …)
│   │   └── logger.mjs          Hook companion — writes session transcripts to MongoDB
│   └── short-term-memory/      Short-term pattern memory MCP (Go + SQLite)
│       └── main.go             MCP server (remember_pattern, find_patterns, get_recent_patterns)
├── .claude/
│   ├── settings.json           Hook configuration
│   ├── skill-registry.md       Auto-generated skill index (gitignored)
│   └── commands/               Slash commands (19 total)
│       ├── recall.md           Memory commands
│       ├── promote.md
│       ├── promote-team.md
│       ├── session-end.md
│       ├── registry-refresh.md
│       ├── wi-start.md         Workitem workflow — unified drivers
│       ├── wi-next.md
│       ├── wi-status.md
│       ├── wi-park.md
│       ├── wi-cancel.md
│       ├── wi-intake.md        Workitem workflow — individual phases
│       ├── wi-analyze.md
│       ├── wi-propose.md
│       ├── wi-plan.md
│       ├── wi-implement.md
│       ├── wi-review.md
│       ├── wi-document.md
│       ├── wi-repo.md
│       └── wi-archive.md
├── workitem/                   Workitem traceability artifacts
│   └── WI-<feature>/
│       ├── source_of_truth.md  Overall workitem state
│       └── <date>-<sub>/       Sub-feature folder
│           ├── intake.md
│           ├── analyze.md
│           ├── approaches.md
│           ├── plan.md
│           ├── implementation.md
│           ├── review.md
│           └── documentation.md
├── .mcp.json                   MCP server registrations
├── CLAUDE.md                   Agent instructions, memory protocol, workitem protocol
└── README.md                   Project documentation
```

---

## Data flow

```mermaid
graph TD
    User -->|prompt| ClaudeCode
    ClaudeCode -->|UserPromptSubmit hook| Logger
    ClaudeCode -->|Stop hook| Logger
    ClaudeCode -->|PreCompact hook| Logger
    Logger -->|session transcript| MongoDB

    ClaudeCode -->|MCP calls| LTM[Long-term MCP]
    ClaudeCode -->|MCP calls| STM[Short-term MCP]
    LTM --> MongoDB[(MongoDB\nagent_memory)]
    STM --> SQLite[(.dako/patterns.db\nSQLite + FTS5)]
```

---

## MCP servers

| Server | Language | Storage | Scope | TTL |
|---|---|---|---|---|
| `dako-long-term-memory` | Node.js | MongoDB | Project or Team | Permanent |
| `dako-short-term-memory` | Go | SQLite (FTS5) | Project, machine-local | 7 days |

---

## Hook pipeline

| Hook | Trigger | Action |
|---|---|---|
| `UserPromptSubmit` | User sends a message | Log user turn to MongoDB `messages` |
| `Stop` | Agent finishes responding | Log assistant turn from JSONL transcript |
| `PreCompact` | Context compression starts | Save last 3 assistant turns as compaction snapshot |

---

## Session state file

`.claude/.dako_session` persists across hook invocations:

```json
{
  "session_id": "<dako-uuid>",
  "claude_session_id": "<claude-conversation-uuid>"
}
```

When `claude_session_id` changes (new conversation), a fresh DakoHarness session is created automatically. See [[Session Logging#Session boundary detection]].

---

## MongoDB collections

| Collection | Contents |
|---|---|
| `memories` | Long-term memories (decisions, conventions, bugs, context, lessons) |
| `sessions` | One document per conversation |
| `messages` | All conversation turns ordered by `seq` |
| `workitems` | Archived completed workitems (wi_path, project, username, git_commit, documentation) |

---

## Related

- [[Memory System]] — how the two tiers work
- [[Session Logging]] — hooks in detail
- [[Workitem Workflow]] — development workflow and artifact structure
- [[Setup Guide]] — wiring it all up
