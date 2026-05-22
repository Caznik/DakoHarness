---
wi: WI-dako-setup/20260522-marketplace-install
phase: intake
status: confirmed
date: 2026-05-22
---

## Request
Expand `/dako:setup` into a full first-time install command — absorb MongoDB check/start, .env creation, and CLAUDE.md injection so marketplace installs work without the setup scripts.

Currently `/dako:setup` only writes `.mcp.json` with `DAKO_PROJECT_ROOT`. With a marketplace install, users have no access to `setup.ps1`/`setup.sh`. The command needs to cover the full onboarding flow so a user who installs via `claude plugin install @claude-community/dako` can get fully configured without cloning the repo.

## Classification
**Type:** feature
**Scope:** `/dako:setup` command, possibly a new `/dako:install` command, cross-platform (Windows + Mac/Linux)

## Routing Decision
**Flow:** full workflow
**Rationale:** Multiple implementation directions (expand existing command vs. new command, how to handle MongoDB cross-platform, how to detect existing config), user-facing behaviour change, worth full analysis and plan.
**Phases:** intake → analyze → propose → plan → implement → review → document → repo → archive

## Confirmation
**Confirmed by user:** yes

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:**
**Reason:**
