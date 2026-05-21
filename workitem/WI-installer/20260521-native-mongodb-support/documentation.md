---
wi: WI-installer/20260521-native-mongodb-support
phase: documentation
status: confirmed
date: 2026-05-21
project-docs-found: yes
---

## Project Documentation Updated

| File | Section | Change |
|---|---|---|
| `obsidian-docs/Setup Guide.md` | Plugin install — Prerequisites | Docker marked optional; MongoDB row added (native or Docker) |
| `obsidian-docs/Setup Guide.md` | Plugin install — Step 2 setup script | Replaced 4-item list with 7-item list reflecting new flow (port detection, credential prompting, connection test) |
| `obsidian-docs/Setup Guide.md` | Standalone dev setup — Prerequisites | Same Docker/MongoDB update applied for consistency |

---

## Workitem Documentation

### What was built

The setup scripts (`setup.sh` and `setup.ps1`) previously assumed MongoDB would always be provided via Docker. If a developer already had MongoDB running natively — or in a different container — the script would either fail or start a redundant container. This workitem makes Docker optional: the scripts now detect whether something is already listening on port 27017 and skip Docker entirely if so. Credential prompting was also added so users can confirm or override credentials rather than having defaults silently written every time.

### How it works

**Port detection (step 1 of both scripts):**
- `setup.sh` uses bash's built-in `/dev/tcp` pseudo-device: `(echo >/dev/tcp/localhost/27017) 2>/dev/null`. This is a bash feature — it requires the script to be invoked as `bash`, which the `#!/usr/bin/env bash` shebang ensures.
- `setup.ps1` uses `Test-NetConnection -ComputerName localhost -Port 27017 -InformationLevel Quiet -WarningAction SilentlyContinue`. The `-InformationLevel Quiet` flag returns a boolean instead of a verbose object, which is then used in a simple `if` check.
- If port 27017 is open: Docker is skipped entirely — no check for `docker info`, no container operations.
- If port 27017 is closed and Docker is unavailable: the script exits with a non-zero code and a clear message.

**Credential prompting (step 2 of both scripts):**
- Before prompting, the script reads the existing `mcps/mongodb-memory/.env` (if present) and extracts `MONGO_USER` and `MONGO_PASSWORD` as defaults. If no `.env` exists, defaults are `dako`/`harness`.
- The user sees the default in brackets (e.g., `MongoDB user [dako]:`) and can press Enter to accept it or type to override.
- The `.env` is always written with the provided values — the previous skip-if-exists guard is removed.

**Connection test (step 3 of both scripts):**
- After writing `.env`, the script runs a short Node.js snippet that connects to MongoDB using the `mongodb` package from `mcps/mongodb-memory/node_modules` with a 3-second timeout.
- If the connection succeeds: "Connected successfully."
- If it fails: a warning is printed but the script continues — the user may have a misconfiguration to fix manually.
- If `node_modules/mongodb` is not present (npm install not yet run): the test is skipped with a hint.

### Usage

No change to the invocation — same commands as before:

```bash
# Mac / Linux
./setup.sh /path/to/your/project

# Windows
.\setup.ps1 -ProjectPath "C:\path\to\your\project"
```

The difference is what happens when MongoDB is already running: the script detects it, skips Docker, and goes straight to credential prompting.

### Known limitations

None — review verdict was `pass`.

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** documentation
**Reason:**
