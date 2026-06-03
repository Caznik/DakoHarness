---
name: wi-repo
description: Run the repo actions phase — suggest a commit message. Never touch git without explicit user approval.
---

## When to use
After documentation is confirmed.

## Steps

### 1. Resolve workitem
- `$ARGUMENTS` → workitem path
- If not provided: list workitems and ask which one
- Read `intake.md`, `plan.md`, `documentation.md`, `review.md`

### 2. Check current branch
- Run `git branch --show-current` (read-only)
- If on `main` or `master`: suggest a feature branch name derived from the workitem ID
  - Example: `feat/WI-retry-logic`
  - **Never create or switch branches without explicit user approval**

### 3. Determine commit type
Based on `intake.md` Classification type:
- `feature` → `feat`
- `bugfix` → `fix`
- `refactor` → `refactor`
- `docs` → `docs`
- Other → `chore`

### 4. Generate commit message (Conventional Commits)

```
<type>(WI-<kebab-feature>): <short description under 72 chars>

<body — drawn from documentation.md "What was built", 1-3 sentences>

Workitem: WI-<kebab-feature>/<YYYYMMDD>-<kebab-sub-feature>
Accepted gaps: <from review.md — only include if verdict was accepted-with-gaps>
```

### 5. Present to user
- Show the suggested commit message (and branch suggestion if applicable)
- Ask: "Use this message, edit it, or write your own?"
- Offer: "Want a PR description as well?"
- Generate PR description only if user asks

### 6. Wait for explicit approval before any git operation
- User must confirm the exact command before it runs
- **Never run `git add`, `git commit`, `git push`, or any branch operation autonomously**
- If user approves: run exactly what was shown, nothing more

### 7. On completion
- Update `source_of_truth.md`: current phase → repo, updated → today
