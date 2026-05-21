---
tags: [dakoharness, workflow, workitems, phase3]
created: 2026-05-21
---

# Workitem Workflow

A structured development workflow with full traceability. Every task produces a set of artifact files under `workitem/` that document requirements, decisions, implementation notes, and the final result.

---

## Phase sequence

```
Intake → Analyze → Propose* → Plan → Implement → Review → Document → Repo → Archive
```

*Propose is conditional — triggered only when the analyze phase surfaces real trade-offs between implementation directions.

---

## Phase table

| # | Phase | Gate | Notes |
|---|---|---|---|
| 1 | **Intake** | Human | Captures request + routing decision (full / partial / free) |
| 2 | **Analyze** | Human (AC sign-off) | Requirements interview → numbered acceptance criteria |
| 3 | **Propose** | Human | Conditional — always writes `approaches.md`, even if `triggered: no` |
| 4 | **Plan** | Human | Sequenced steps, each referencing AC IDs; full coverage required |
| 5.1 | **Architecture** | Automated | Explore existing patterns before writing any code |
| 5.2 | **Coding** | — | TDD: red → green → refactor; inline docs written here |
| 5.3 | **QA loop** | Automated | Iterates until all ACs pass or user accepts a gap |
| 5.4 | **Regression** | Automated | Existing test suite must still pass |
| 6 | **Review** | Human | AC verification + plan coverage + deviations → verdict |
| 7 | **Document** | Human | Update project docs; write workitem documentation record |
| 8 | **Repo** | Human | Suggest commit message only — never touch git without approval |
| 9 | **Archive** | Automated | Store workitem to MongoDB `workitems` collection |

---

## Routing

```
User request received
  ├─ Not a development task → free flow (no workitem created)
  ├─ Targets a specific phase ("just plan this") → partial workflow
  └─ Development request → full workflow from intake
```

The routing decision is always shown to the user for confirmation before any files are created.

---

## Workitem structure

```
workitem/
  WI-<kebab-feature>/
    source_of_truth.md              ← status, current phase, blockers, decisions log
    <YYYYMMDD>-<kebab-sub-feature>/
      intake.md
      analyze.md
      approaches.md                 ← always created; triggered: yes | no
      plan.md
      implementation.md
      review.md
      documentation.md
```

### `source_of_truth.md`

Lives at the `WI-<feature>/` level. Tracks the overall workitem across potentially multiple sub-features. First file to read when returning to a workitem cold.

Fields: `status` (active / completed / blocked / parked / cancelled), current phase, sub-features table, active blockers, key decisions log.

---

## Artifact templates

### `intake.md`
```
phase: intake | status: pending → confirmed | cancelled
Fields: request, classification (type + scope), routing decision (flow + rationale + phases), confirmation, cancellation
```

### `analyze.md`
```
phase: analyze | status: pending → confirmed | cancelled
Fields: requirements, out of scope, open questions, acceptance criteria (AC-1…), interview notes, sign-off
```

### `approaches.md`
```
phase: propose | triggered: yes | no
Fields: Approach A/B/C (summary, pros, cons, effort), selected approach + rationale, confirmation
```

### `plan.md`
```
phase: plan | approach: A | B | C
Fields: AC coverage map, implementation sequence (steps with Satisfies + Files + Description), risks
```

### `implementation.md`
```
phase: implementation | status: in-progress → completed | blocked | cancelled
Fields: architecture notes, plan deviations table, blockers table, QA log (iteration × AC × result), regression result
```

### `review.md`
```
phase: review | verdict: pass | fail | accepted-with-gaps
Fields: AC verification table, plan coverage table, deviations review, gaps, verdict, confirmation
```

### `documentation.md`
```
phase: documentation | project-docs-found: yes | no
Fields: project documentation updated (table), workitem documentation (what/how/usage/limitations)
```

---

## QA loop exit conditions

The QA loop exits when **either** condition is met:
1. All acceptance criteria from `analyze.md` pass
2. User explicitly accepts a known gap in writing

**Never exit by weakening an AC.** Only by satisfying it or explicit user acceptance.

---

## Review verdicts

| Verdict | Meaning |
|---|---|
| `pass` | All ACs satisfied, all plan steps implemented, no unaccepted concerns |
| `fail` | Gaps exist that the user has not accepted — send back to implementation |
| `accepted-with-gaps` | Gaps exist but user explicitly accepted each one — workitem closes cleanly |

---

## Archive schema

Completed workitems are stored in MongoDB `workitems` collection:

| Field | Description |
|---|---|
| `wi_path` | `WI-<feature>/<date>-<sub-feature>` |
| `project` | Project name |
| `username` | From `git config user.name` (optional) |
| `git_commit` | SHA of closing commit (optional) |
| `documentation` | Full text of `documentation.md` Workitem Documentation section |
| `archived_at` | Timestamp |

---

## Commands

### Unified (workflow drivers)

| Command | Description |
|---|---|
| `/wi-start [description]` | Start a new workitem — routing + intake + chain into full workflow |
| `/wi-next` | Advance current workitem to next phase |
| `/wi-status` | Show current workitem state |
| `/wi-park` | Pause without cancelling |
| `/wi-cancel` | Cancel workitem or current phase — files always kept |

### Individual (phase entry points)

| Command | Phase |
|---|---|
| `/wi-intake <wi-path>` | Intake only |
| `/wi-analyze <wi-path>` | Analyze only |
| `/wi-propose <wi-path>` | Propose only |
| `/wi-plan <wi-path>` | Plan only |
| `/wi-implement <wi-path>` | Full implementation sub-phases |
| `/wi-review <wi-path>` | Review only |
| `/wi-document <wi-path>` | Documentation only |
| `/wi-repo <wi-path>` | Repo actions only |
| `/wi-archive <wi-path>` | Archive to MongoDB |

> [!NOTE]
> Unified commands auto-detect the active workitem. Individual commands require the user to specify the workitem path.

---

## Key rules

> [!WARNING]
> - Never create workitem files until the user explicitly confirms the routing decision
> - Never run `git add`, `git commit`, `git push`, or branch operations without explicit user approval
> - Log all plan deviations silently in `implementation.md` — never discard them
> - `approaches.md` is always created, even when only one approach exists (`triggered: no`)

---

## Related

- [[Architecture#Component map]] — where workitem/ lives in the project
- [[Slash Commands#Workitem workflow]] — command reference
- [[Roadmap#Phase 3]] — delivery status
