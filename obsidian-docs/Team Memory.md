---
tags: [dakoharness, memory, team]
created: 2026-05-20
---

# Team Memory

Long-term memory is stored in a shared MongoDB instance, making it accessible to all developers on the same team. Team memory lets a lesson learned in one project benefit developers working on entirely different projects.

---

## How scope works

Every memory has a `scope` field:

| Scope | Default | Visible to |
|---|---|---|
| `project` | Yes | Only queries for this specific project |
| `team` | No | All projects on the same MongoDB instance |

Memories default to `project` scope. Promotion to `team` scope is always **explicit** — no automatic cross-project leaking.

---

## Why explicit promotion

Automatic cross-project sharing would flood context with irrelevant history. A developer working on a Python data pipeline doesn't need to know about a TypeScript convention from another project.

The rule: **a human decides when a lesson is broadly applicable**. The agent proposes; the developer confirms.

---

## Promotion workflow

```
Developer B learns something in ProjectY
    ↓
/promote-team <keywords>
    ↓
Agent finds the memory, validates it's broadly applicable
    ↓
Calls promote_to_team — scope updated to "team" in MongoDB
    ↓
Developer A on ProjectX runs:
recall(project="ProjectX", query="...", include_team=true)
    ↓
ProjectX memories + team-scoped memories from all projects returned
```

---

## When to promote to team scope

Good candidates:
- A language/framework anti-pattern that burned the team (e.g. "never use X for Y in Node.js")
- A cross-cutting convention the whole team should follow
- A security or performance lesson with broad applicability

Poor candidates:
- Project-specific business logic
- Decisions tied to one codebase's architecture
- Anything that only makes sense with that project's context

---

## Searching team memories

Use `recall` with `include_team: true` to search across project + team memories:

```
recall(
  project: "MyProject",
  query: "retry logic",
  include_team: true
)
```

This returns:
- All memories scoped to `MyProject`
- All memories with `scope: "team"` from any project

---

## Related

- [[Memory System#Memory scope]] — scope field reference
- [[Slash Commands#/promote-team]] — promotion command
- [[Architecture]] — MongoDB setup
