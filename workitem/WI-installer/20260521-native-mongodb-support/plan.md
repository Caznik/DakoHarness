---
wi: WI-installer/20260521-native-mongodb-support
phase: plan
status: confirmed
date: 2026-05-21
approach: single approach (propose not triggered)
---

## Context
**Selected approach:** Port-first detection → Docker/skip decision → credential prompting → connection test
**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6

## Implementation Sequence

### Step 1 — Port detection
**Satisfies:** AC-1, AC-2, AC-3
**Files:** `setup.sh`, `setup.ps1`
**Description:** Replace the hard upfront Docker check with a port-first block. Before touching Docker:
- `setup.sh`: use `(echo >/dev/tcp/localhost/27017) 2>/dev/null` — bash built-in, no external dependency. If open → set `MONGO_DETECTED=true`, print "MongoDB detected on port 27017 — skipping Docker." If closed → check `docker info`; if Docker not running exit with error (AC-2), otherwise proceed with container start (AC-3, existing logic preserved).
- `setup.ps1`: use `Test-NetConnection -ComputerName localhost -Port 27017 -InformationLevel Quiet -WarningAction SilentlyContinue`. Same branching logic. Docker check becomes conditional on `$MongoDetected -eq $false`.

### Step 2 — Credential prompting with defaults
**Satisfies:** AC-4
**Files:** `setup.sh`, `setup.ps1`
**Description:** Replace the skip-if-exists `.env` block in both scripts with interactive credential prompting. Before prompting: read `mcps/mongodb-memory/.env` if it exists and extract `MONGO_USER` / `MONGO_PASSWORD` as defaults; otherwise default to `dako` / `harness`. Show defaults in brackets and accept Enter to use them.
- `setup.sh`: `read -p "MongoDB user [dako]: " INPUT; MONGO_USER="${INPUT:-dako}"`. Use `read -s` for password to suppress echo.
- `setup.ps1`: parse existing `.env` with `Select-String`; use `Read-Host "MongoDB user [$DEFAULT_USER]"`. Empty string → use default. `Read-Host -AsSecureString` for password, converted back via `Marshal` for .env writing.
Always write `.env` using the prompted values (no longer skip-if-exists).

### Step 3 — Connection test
**Satisfies:** AC-5
**Files:** `setup.sh`, `setup.ps1`
**Description:** After writing `.env`, attempt a single MongoDB connection using Node.js and the `mongodb` package from `mcps/mongodb-memory/node_modules`. If connection succeeds, print confirmation. If it fails, print a warning to stderr and continue — script does not abort.
- `setup.sh`: inline `node -e` with `require()` from `$SCRIPT_DIR/mcps/mongodb-memory/node_modules/mongodb`.
- `setup.ps1`: same via `node -e` with the Windows path.
If `node_modules` does not exist (npm install not yet run), print: "Skipping connection test — run 'npm install --prefix mcps/mongodb-memory' first."

## Risks / Known Unknowns

1. **`/dev/tcp` on bash**: requires `bash`, not `sh`. Shebang is `#!/usr/bin/env bash` — safe, but `sh setup.sh` will fail silently.
2. **`Test-NetConnection` timeout**: blocks ~1s on a closed port. Acceptable; `-WarningAction SilentlyContinue` suppresses output noise.
3. **`Read-Host` password in PowerShell**: `Read-Host -AsSecureString` returns `SecureString` — convert to plaintext via `[Runtime.InteropServices.Marshal]::PtrToStringAuto(...)` for `.env` writing.
4. **node_modules not present**: connection test falls back to a hint rather than a hard failure.
5. **Step labels in console output**: current `[1/4]`…`[4/4]` labels need updating to reflect the new flow.

## Confirmation
**Confirmed by user:** yes
**Notes:**

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
