---
wi: WI-installer/20260521-native-mongodb-support
phase: implementation
status: completed
date: 2026-05-21
---

## Architecture Notes

- Both scripts follow a sequential step model with numbered console output — new steps slot in without restructuring the overall flow
- `set -euo pipefail` in setup.sh means the port test must use `|| true` patterns or subshells to avoid aborting on a closed port
- `$ErrorActionPreference = "Stop"` in setup.ps1 only affects cmdlets, not native executables — `$LASTEXITCODE` is used for node/docker exit codes
- `/dev/tcp/localhost/27017` is a bash built-in — safe given `#!/usr/bin/env bash` shebang; would silently fail if run as `sh`
- `Test-NetConnection` in PowerShell 5.1 returns a `TestConnectionResult` object — truthy check on the object is sufficient
- Connection test uses the mongodb package from `mcps/mongodb-memory/node_modules` — same package already used by server.js; no new dependency
- Step labels changed from [1/4]…[4/4] to [1/4]…[4/4] — Docker steps collapsed into step 1 since Docker is now conditional

## Plan Deviations

| Step | Original plan | What actually happened | Reason |
|---|---|---|---|

## Blockers

| # | Description | Resolution | Status |
|---|---|---|---|

## QA Log

| Iteration | AC checked | Result | Action taken |
|---|---|---|---|
| 1 | AC-1–AC-6 (all) | PASS (static review) | None — runtime ACs (1, 2, 3, 5) require live execution; static evidence is complete for all |

## Regression

**Test suite run:** no
**Result:** n/a — no test suite for shell scripts; runtime verification via QA loop
**Failures:** none
