---
tags: [dakoharness, roadmap, planning]
created: 2026-05-20
---

# Roadmap

## Phases

| Phase | Status | Description |
|---|---|---|
| 1 — Memory foundation | Done ✅ | Long-term MCP, short-term MCP, session logging, slash commands |
| 2 — Memory hardening | Done ✅ | Compaction recovery, session boundaries, team scope, skill registry |
| 3 — Development workflow | Done ✅ | Workitem workflow, 14 wi-* commands, artifact templates, workitems archive |
| 4 — Skill registry | Done ✅ | Delivered early in Phase 2 |
| 5 — Installer | Done ✅ | Claude Code plugin ("dako"), cross-platform binaries, setup scripts, --plugin-dir distribution |
| 6 — Marketplace | Under review 🔄 | Submitted to community marketplace — awaiting review |
| 7 — Semantic recall | Done ✅ | Local embedding backend, hybrid (FTS + vector) recall on memories, semantic recall over session messages, SQLite→MongoDB migrator |
| 8 — Multi-agent | Backlog | Adapters for OpenCode, Pi, Codex CLI |

---

## Phase 1 — Memory foundation ✅

- Long-term memory MCP (Node.js + TypeScript; pluggable storage backend — MongoDB or SQLite)
- Short-term memory MCP (Go / SQLite / FTS5 / 7-day TTL)
- Session logging via Claude Code hooks (UserPromptSubmit, Stop); hook logger routes through storage abstraction
- CLAUDE.md memory protocol
- Slash commands: /recall, /promote, /session-end
- `forget` tool for deleting stale memories
- Storage abstraction layer (`storage/` subfolder): `Storage` interface, `MongoStorage` adapter, `SqliteStorage` adapter, backend factory

---

## Phase 2 — Memory hardening ✅

- **Compaction recovery** — PreCompact hook saves snapshot; CLAUDE.md drives recovery on next session
- **Session boundary detection** — `claude_session_id` in `.dako_session`; new conversation auto-creates new session
- **Team scope** — `scope` field on memories; `promote_to_team` MCP tool; `/promote-team` command; `include_team` flag on `recall`
- **Skill registry** — `.claude/skill-registry.md`; `/registry-refresh` command

---

## Phase 3 — Development workflow ✅

Architecture principle: **structured traceability via workitems, human gates at every major phase**

### Workitem workflow
Full intake → analyze → propose → plan → implement → review → document → repo → archive pipeline.
Every task gets a folder under `workitem/WI-<feature>/` with per-phase artifact files.

### Commands (14 total)
**Unified:** `/wi-start`, `/wi-next`, `/wi-status`, `/wi-park`, `/wi-cancel`  
**Individual phases:** `/wi-intake`, `/wi-analyze`, `/wi-propose`, `/wi-plan`, `/wi-implement`, `/wi-review`, `/wi-document`, `/wi-repo`, `/wi-archive`

### Artifact templates
Per-phase `.md` files with YAML frontmatter, status tracking, and acceptance criteria linkage.
`source_of_truth.md` at the workitem level tracks overall state and sub-features.

### MongoDB
New `workitems` collection — completed workitems archived via `archive_workitem` MCP tool.

See [[Workitem Workflow]] for full documentation.

---

## Phase 5 — Installer ✅

DakoHarness is now a proper Claude Code plugin distributed via `--plugin-dir`.

### Plugin structure (`name: "dako"`)
- `.claude-plugin/plugin.json` — manifest; drives `/dako:*` command namespacing
- `commands/` — 20 `.md` files (19 migrated from `.claude/commands/` + new `/dako:setup`)
- `hooks/hooks.json` — `UserPromptSubmit`, `Stop`, `PreCompact` hooks via `dako-logger` wrapper
- `bin/` — executables and wrappers; auto-added to PATH on marketplace installs, manual PATH setup required for `--plugin-dir` mode

### Cross-platform binaries (`bin/`)
| File | Platform |
|---|---|
| `dako-stm.exe` | Windows |
| `dako-stm-linux` | Linux (amd64) |
| `dako-stm-darwin` | macOS (amd64) |
| `dako-stm` | Unix wrapper (uname detection) |
| `dako-stm.bat` | Windows wrapper |
| `dako-logger` | Unix hook wrapper |
| `dako-logger.bat` | Windows hook wrapper |

### Setup
- `setup.sh` / `setup.ps1` — start MongoDB via Docker, create `.env`, inject CLAUDE.md memory protocol into target project
- `/dako:setup` skill — set `DAKO_PROJECT_ROOT` per project

### Distribution
Loaded via `--plugin-dir ./DakoHarness` or `claude plugin install`. Community marketplace submission is a follow-up.

See [[Setup Guide]] for installation steps.

> [!NOTE]
> Runtime ACs (command resolution, hook firing, MCP path resolution) require a live `--plugin-dir` test. Static validation passes (`claude plugin validate .`).

---

## Phase 6 — Marketplace (Under review 🔄)

The `dako` plugin has been submitted to the Claude Code Community Marketplace. Once approved, users can install it with a single command instead of cloning the repo and using `--plugin-dir`.

### Submitted
- Plugin folder (`claude-plugin-release/`) validated with `claude plugin validate`
- Submitted via `claude.ai/settings/plugins/submit`
- Currently awaiting marketplace review

### Post-approval
- Update Setup Guide with `claude plugin install dako` as the primary install path
- Announce to users

---

## Phase 7 — Semantic recall ✅

Local embeddings, hybrid retrieval on long-term memory, and semantic recall over the captured conversation history.

### Storage backend flexibility
- Pluggable storage layer (`DAKO_STORAGE_BACKEND=mongodb|sqlite`) — runs without Docker for solo/local use
- One-shot `npm run migrate` (in `mcps/mongodb-memory`) copies all four collections (`memories`, `workitems`, `sessions`, `messages`) from SQLite → MongoDB with abort-and-rollback semantics, idempotent on dedup, format-preserving `.env` rewrite

### Local embedding backend
- `@xenova/transformers` ONNX inference; default model `Xenova/all-MiniLM-L6-v2`, 384-dim, ~30MB, English-tuned
- `DAKO_EMBEDDING_MODEL` env var swaps the model; rows are tagged so mixed-model installs degrade gracefully
- Float32 raw-byte layout — SQLite `BLOB`, MongoDB `Binary` subtype 0; same shape across both adapters
- In-app cosine — no native vector index required, keeps the default standalone Docker install zero-setup
- One-shot `npm run embed-backfill` backfills pre-existing rows; `--dry-run`, `--force`, and per-batch error isolation

### Hybrid recall on memories
- `recall` accepts `mode: "keyword" | "vector" | "hybrid"`; default auto-detects based on whether any embedded rows exist for the current model
- **Reciprocal Rank Fusion** (k=60, equal weights, 2× limit candidates) merges FTS and vector halves; single-side fallback if one side is empty
- New `embed_query` MCP tool so the `/recall` skill preflights the query embedding once and reuses it across keyword-variant calls

### Semantic recall over messages (RAG for long sessions)
- `messages` collection gains optional `embedding` + `embedding_model` (both adapters)
- `log_message` inline-embeds `role + ": " + content` at insert time with skip rules (empty / <20 chars / role=tool); failure-graceful contract (insert always succeeds)
- New `recall_session_messages` MCP tool — vector-only retrieval; default scope **project-wide** (omit `session_id` to search every session); optional ISO-8601 `since` cutoff
- New `/recall-session <query> [session=<id>] [since=<iso>]` skill — calls `embed_query` once, then `recall_session_messages`; mirrored at all three skill locations
- `embed-backfill` extended with `--collection memories|messages|all` (default stays `memories` for back-compat)
- CLAUDE.md compaction-recovery hint points at `/recall-session` as the deeper-history surface beyond the auto-saved snapshot

---

## Phase 8 — Multi-agent (Backlog)

Per-agent adapter layer for:
- OpenCode
- Pi
- Codex CLI

---

## Backlog

| Item | Description |
|---|---|
| Multi-agent adapters | Phase 8 — OpenCode, Pi, Codex CLI. |
| Context7 / Notion / Jira MCPs | External knowledge source integrations. |
| Model routing | Route tasks to different models based on complexity. |
| Permission harness | Structured permission management layer. |
| MongoDB dashboard | Visual interface for browsing sessions and memories. |
| Native vector indexes | Atlas `vectorSearch` and/or `sqlite-vec` to scale beyond in-app cosine; byte layout already forward-compatible. |
| TS housekeeping pass | Fix the pre-existing `tsc` errors in `mcps/mongodb-memory` (missing `@types/better-sqlite3`, missing `@xenova/transformers` types, MCP SDK `setRequestHandler` signature drift) so `npm test` runs cleanly end-to-end. |

---

## Related

- [[Architecture]] — current system state
- [[Home]] — project overview
