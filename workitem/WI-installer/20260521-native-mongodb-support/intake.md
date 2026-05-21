---
wi: WI-installer/20260521-native-mongodb-support
phase: intake
status: confirmed
date: 2026-05-21
---

## Request

Support native MongoDB installations in setup scripts. Currently the scripts assume MongoDB is provided via Docker, but users may already have MongoDB installed natively on their machine. The scripts should detect if MongoDB is already running on port 27017 (Docker or native) and skip container startup. When skipping, the user should be prompted to confirm credentials rather than having defaults silently written to .env.

## Classification

**Type:** enhancement
**Scope:** Behavioural change to existing `setup.sh` and `setup.ps1` — affects the installer user experience for users with pre-existing MongoDB installations.

## Routing Decision

**Flow:** full
**Rationale:** Requires requirements elicitation (credential prompting UX, detection logic, fallback behaviour across two platforms). Behavioural change with enough edge cases to warrant structured tracking.
**Phases:** intake → analyze → propose* → plan → implement → review → document → repo → archive

## Confirmation

**Confirmed by user:** yes

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:**
**Reason:**
