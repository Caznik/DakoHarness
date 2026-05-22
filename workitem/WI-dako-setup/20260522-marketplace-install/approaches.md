---
wi: WI-dako-setup/20260522-marketplace-install
phase: propose
status: confirmed
date: 2026-05-22
triggered: yes
---

## Approach A — Ask the user every time
**Summary:** The agent's first step is always to ask the user where DakoHarness is installed. Path is used for that run only, never persisted.
**Pros:**
- Always correct, no staleness risk
- Zero magic, works in every install mode
**Cons:**
- Friction on every run
- Annoying for re-runs and idempotency checks
**Effort:** Low

## Approach B — `DAKO_HOME` environment variable with fallback
**Summary:** Check `$env:DAKO_HOME` (Windows) / `$DAKO_HOME` (Unix) first. If not set, ask once and instruct the user to add it to their shell profile.
**Pros:**
- Zero friction after one-time env var setup
- Standard pattern for developer tools
- Fallback keeps it working without the var
**Cons:**
- Requires users to set an env var (extra setup step)
- Not automatic in marketplace installs
**Effort:** Low–Medium

## Approach C — Persist path in a user config file
**Summary:** On first run, ask for (or discover) the DakoHarness path and write it to `~/.dako/config`. All subsequent runs read from there silently. Falls back to asking if the file is missing or the path is invalid.
**Pros:**
- Most seamless UX after first run — fully automatic
- No shell profile changes needed
- Survives terminal restarts
**Cons:**
- Introduces a config file the user may not know about
- Potential for stale path if DakoHarness is moved (mitigated by validation + fallback)
**Effort:** Medium

## Selected Approach
**Choice:** Approach C
**Rationale:** Best long-term UX — marketplace users especially shouldn't have to provide the path on every run or manage environment variables. The config file is a one-time write and the fallback handles the stale-path case cleanly.

## Confirmation
**Confirmed by user:** yes
**Notes:**

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** propose
**Reason:**
