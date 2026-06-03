---
name: recall-session
description: "Search conversation history with semantic recall. Usage: /recall-session <query> [session=<id>] [since=<iso>]"
---

Search past conversation turns (across one or all sessions in the project) using semantic similarity. Useful in long sessions or after compaction when you need to recover a specific earlier exchange.

## Steps

1. Determine the project name: use the `DAKO_PROJECT` environment variable if set, otherwise use the basename of the current working directory.

2. If no args were provided, ask the user what they want to search for before proceeding.

3. **Parse optional inline filters from args.** Tokens of the form `session=<id>` and `since=<iso>` are filters; everything else concatenated (in order) is the query text. Examples:
   - `/recall-session redis caching` — query = "redis caching", no filters
   - `/recall-session session=abc12345 retry logic` — query = "retry logic", session_id = "abc12345"
   - `/recall-session since=2026-05-20 mongo schema` — query = "mongo schema", since = "2026-05-20"

4. **Embed the query.** Call the `embed_query` MCP tool with `text = <query>`. Parse the returned JSON to extract the `embedding` field (base64 Float32 vector). If the call errors, proceed with `embedding = null` — the server will compute the embedding itself.

5. **Call `recall_session_messages`** with:
   - `project`: from step 1
   - `query`: the parsed query text
   - `embedding`: value from step 4 (omit if null)
   - `session_id`: the parsed value (omit if not provided — default is project-wide)
   - `since`: the parsed ISO-8601 value (omit if not provided)
   - `limit`: 10

6. **Present results grouped by session.** For each session present, show `## Session <short-id>` then each matching turn on its own line in the form `[<iso timestamp>] [<role>]: <content>`. Order sessions by recency (most-recent-turn-first within each); within a session, order by similarity descending (the server's order). Note the variant coverage is N/A here — this is a single-call skill.

7. If the tool returns the "No matching messages found …" text, say so plainly and suggest proceeding without prior context — do not invent or infer turns that weren't returned.
