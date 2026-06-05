---
wi: WI-workflow-metrics
sub_feature: 20260605-artifact-telemetry
phase: intake
status: confirmed
date: 2026-06-05
---

# Intake — Workflow metrics / artifact telemetry

## Request

> Spin up a workitem for the Metrics layer — harvest per-phase workitem artifacts into workflow telemetry (AC pass rate, QA-loop iterations, replan frequency, time per phase) stored in the workitems MongoDB collection.

### Motivation

DakoHarness benchmarked itself against an external harness capability map (5 tiers × 20 components). "Metrics" was the one capability that was both **completely absent** and **directly buildable on data already produced** — every workitem phase already writes structured `.md` artifacts, but nothing harvests them. Metrics would let the project *prove* the workflow works (and later feed an Optimize/self-improvement loop).

## Classification

- **Type:** New feature (telemetry / reporting subsystem)
- **Scope / what changes:** A new capability that reads per-phase artifact files (`intake.md`, `analyze.md`, `plan.md`, `implementation.md`, `review.md`, …) and `source_of_truth.md`, derives metrics, and persists/exposes them alongside the existing `workitems` collection in the long-term-memory MCP. Candidate metrics: AC pass rate, QA-loop iteration count, replan frequency, time per phase, gate turnaround.

## Constraints (stated)

- **Collection mechanism = retroactive harvest** of existing artifact `.md` files. Must work over all existing workitems immediately, with no changes required to the wi-* commands. (Live instrumentation deferred as possible follow-up.)
- Storage target is the existing `workitems` MongoDB collection (or an adjacent structure in the same storage abstraction — to be settled in analyze).

## Routing Decision

- **Flow:** Full workflow (intake → analyze → propose? → plan → implement → review → document → repo → archive)
- **Rationale:** Cross-cutting feature touching the storage layer and parsing logic; behavior-affecting and non-trivial. Free flow rejected (not a typo/config tweak); partial flow rejected (no single phase targeted — the metric set itself needs an analyze interview to scope).

## Confirmation

- Confirmed by user: **yes** (routing + retroactive-harvest approach selected at intake)

## Cancellation

_Not cancelled._
