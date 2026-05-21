---
wi: WI-installer/20260521-native-mongodb-support
phase: analyze
status: confirmed
date: 2026-05-21
---

## Requirements

1. Before any Docker operation, detect whether something is already listening on port 27017
2. If port 27017 is responding: skip Docker entirely, proceed to credential prompting
3. If port 27017 is not responding and Docker is not installed: exit with a clear error — "MongoDB is not running on port 27017. Install Docker or start MongoDB first."
4. If port 27017 is not responding and Docker is installed: start mcp_mongodb container (existing behaviour, unchanged)
5. Credential prompting: display defaults and accept Enter to use them
   - If mcps/mongodb-memory/.env already exists: use existing values as defaults
   - Otherwise: use hardcoded defaults (dako / harness)
6. After writing .env: attempt a single test connection to MongoDB with the provided credentials — print a warning if it fails, but do not abort
7. Both setup.sh (Mac/Linux) and setup.ps1 (Windows) implement all of the above

## Out of Scope

- Automatic Docker installation
- Automatic MongoDB native installation
- Non-default ports (only 27017)
- Connection retry logic (single test attempt only)
- Credential storage outside mcps/mongodb-memory/.env

## Open Questions

None.

## Acceptance Criteria

- [ ] **AC-1** — If port 27017 is responding, the script skips Docker startup and prints a message indicating MongoDB was detected
- [ ] **AC-2** — If port 27017 is not responding and Docker is not installed, the script exits with a non-zero code and a clear error message
- [ ] **AC-3** — If port 27017 is not responding and Docker is installed, the script starts the mcp_mongodb container (or skips if it exists) — existing behaviour preserved
- [ ] **AC-4** — Credential prompt shows defaults: existing .env values if the file exists, otherwise dako/harness; pressing Enter accepts the default without typing
- [ ] **AC-5** — After writing .env, the script tests the MongoDB connection and prints a warning if the credentials do not work (script does not abort on failure)
- [ ] **AC-6** — All ACs above are satisfied by both setup.sh and setup.ps1

## Interview Notes

- Docker is now optional: if MongoDB is already running (native or container), Docker is not needed at all
- Credential prompting with defaults covers both first-time users (hardcoded defaults) and users re-running setup (existing .env surfaced as defaults)
- Connection test is best-effort: a warning rather than a hard failure, since the user may fix credentials manually after setup

## Sign-off

**Confirmed by user:** yes
**Date:** 2026-05-21
