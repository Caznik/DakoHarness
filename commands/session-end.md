---
name: session-end
description: End-of-session cleanup — review what happened, promote valuable patterns to long-term memory, and leave a clean state for the next session.
---

Perform end-of-session memory cleanup for the current project.

## Steps

1. Determine the project name: use the `DAKO_PROJECT` environment variable if set, otherwise use the basename of the current working directory.

2. Load both memory tiers in parallel:
   - Call `get_recent_patterns` with `project` to get short-term patterns from this session
   - Call `get_context` with `project` to get what is already in long-term memory

3. If no short-term patterns exist, say so and skip to step 6.

4. Compare the two tiers. For each short-term pattern, ask: is this already captured in long-term memory (same idea, even if worded differently)?
   - If yes: skip it — no value in duplicating
   - If no: evaluate whether it deserves permanence using these criteria:
     - It reflects a decision, convention, or lesson that will still matter in future sessions
     - It is not obvious from reading the code
     - It would prevent a future agent from repeating a mistake or re-deriving the same conclusion

5. For each pattern that passes the criteria, call `remember` with:
   - `project`: from step 1
   - `agent`: `"claude-code"`
   - `type`: inferred from content (`decision`, `convention`, `bug`, `context`, or `lesson`)
   - `title`: concise one-line title
   - `content`: the pattern's reasoning — include WHY, not just what
   - `tags`: carry over the pattern's tags if present

6. If there is meaningful in-progress work that should be picked up next session (a task started but not finished, a decision deferred, a question left open), save a `context` memory titled "Next session: <topic>" describing what to resume and why it was left here.

7. Report what was done:
   - How many patterns were reviewed
   - Which were promoted (type + title)
   - Which were skipped and why (duplicate or not durable enough)
   - Any "next session" note saved
   
   Keep the report concise — one line per item.
