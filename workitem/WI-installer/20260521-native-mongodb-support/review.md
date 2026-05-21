---
wi: WI-installer/20260521-native-mongodb-support
phase: review
status: confirmed
date: 2026-05-21
verdict: pass
---

## AC Verification

| AC | Description | Satisfied | Evidence / Notes |
|---|---|---|---|
| AC-1 | Port 27017 responding → skip Docker, print detection message | yes | `setup.sh`: `(echo >/dev/tcp/localhost/27017) 2>/dev/null` → "Detected on port 27017 — skipping Docker."; `setup.ps1`: `Test-NetConnection -InformationLevel Quiet` same path |
| AC-2 | Port closed + no Docker → non-zero exit + clear error | yes | Both scripts: `docker info` check reached only when port check fails; failure → `exit 1` with "MongoDB is not running on port 27017. Install Docker or start MongoDB first." |
| AC-3 | Port closed + Docker available → start/skip container | yes | Existing `docker run` / skip-if-running block preserved inside the `else` branch; no behaviour change on Docker path |
| AC-4 | Credential prompt with defaults; Enter accepts; always writes .env | yes | Both scripts read existing `.env` for defaults (grep/Where-Object), fall back to `dako`/`harness`; `${INPUT:-$DEFAULT}` (bash) / `if ($in) { $in } else { $default }` (PS); skip-if-exists guard removed |
| AC-5 | Connection test warns on failure, doesn't abort | yes | `setup.sh`: `if node -e ...` (safe under `set -e`); `setup.ps1`: `$LASTEXITCODE` check; both print WARNING and continue; node_modules absent → graceful skip with hint |
| AC-6 | Both scripts implement all ACs | yes | All changes present in both `setup.sh` and `setup.ps1` |

## Plan Coverage

| Step | Implemented | Notes |
|---|---|---|
| Step 1 — Port detection | yes | Both scripts |
| Step 2 — Credential prompting with defaults | yes | Both scripts; always-write replaces skip-if-exists |
| Step 3 — Connection test | yes | Both scripts; graceful skip when node_modules absent |

## Deviations Review

No deviations logged.

## Gaps

None.

## Verdict

**Result:** pass
**Accepted gaps:** none

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** review
**Reason:**
