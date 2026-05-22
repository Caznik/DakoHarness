---
name: promote-team
description: Promote a project memory to team scope so it is searchable across all projects by any developer.
---

Promote a memory from project scope to team scope for the current project.

## Steps

1. Determine the project name: use `DAKO_PROJECT` env var if set, otherwise basename of cwd.

2. Find the candidate memory:
   - If keywords were provided in args, call `recall` with `project` and `query` set to the keywords.
   - If no keywords, ask the user which memory to promote and what keywords to search for.

3. If no memories found, tell the user and stop.

4. If one memory is found, use it as the candidate. If multiple, present them and ask the user which one.

5. Confirm the promotion makes sense as a **team-level** lesson:
   - It should be broadly applicable beyond this specific project
   - It should be a principle, pattern, or lesson another developer in a different project could reuse
   - If it is too project-specific, tell the user and suggest keeping it at project scope

6. Call `promote_to_team` with:
   - `project`: from step 1
   - `title`: exact title of the memory
   - `type`: (optional) to disambiguate if needed

7. Confirm: "Promoted to team scope: «title». It will now appear in team-wide searches."
