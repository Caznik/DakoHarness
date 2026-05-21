---
name: promote
description: Promote a short-term pattern to long-term memory. Usage: /promote [keywords]
---

Move a short-term pattern into permanent long-term memory for the current project.

## Steps

1. Determine the project name: use the `DAKO_PROJECT` environment variable if set, otherwise use the basename of the current working directory.

2. Find candidate patterns:
   - If keywords were provided in args, call `find_patterns` with `project` and `query` set to the keywords.
   - If no keywords were provided, call `get_recent_patterns` with `project` to show all recent patterns.

3. If no patterns are found, tell the user there is nothing to promote and stop.

4. If one pattern is found, use it as the candidate. If multiple are found, present them clearly and ask the user which one to promote.

5. Determine the long-term memory type. Infer from the pattern's content when possible:
   - `decision` — an architectural or design choice with reasoning
   - `convention` — a naming rule, code style, or recurring pattern
   - `bug` — a bug and how it was fixed
   - `context` — an important project fact not obvious from the code
   - `lesson` — what went wrong and what was learned

   If the type is not obvious, ask the user to confirm before proceeding.

6. Call `remember` with:
   - `project`: from step 1
   - `agent`: `"claude-code"`
   - `type`: from step 5
   - `title`: a concise one-line title derived from the pattern
   - `content`: the pattern's approach and reasoning — include WHY, not just what
   - `tags`: carry over the pattern's tags if present

7. Confirm what was saved: show the type and title. Do not repeat the full content back.
