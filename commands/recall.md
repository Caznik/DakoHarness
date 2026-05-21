---
name: recall
description: "Search long-term memory for past decisions, conventions, bugs, and lessons relevant to the current task. Usage: /recall <keywords>"
---

Search long-term memory for context relevant to the keywords the user provided.

## Steps

1. Determine the project name: use the `DAKO_PROJECT` environment variable if set, otherwise use the basename of the current working directory.

2. If no keywords were provided in args, ask the user what they want to search for before proceeding.

3. Call the `recall` tool with:
   - `project`: the project name from step 1
   - `query`: the keywords from args
   - `limit`: 5

4. Present the results grouped by memory type (DECISION, CONVENTION, BUG, CONTEXT, LESSON). For each result show the title and content clearly.

5. If no results are found, say so plainly and suggest the user proceed without prior context — do not invent or infer memories that weren't returned.
