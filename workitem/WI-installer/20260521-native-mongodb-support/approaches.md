---
wi: WI-installer/20260521-native-mongodb-support
phase: propose
triggered: no
date: 2026-05-21
---

## Decision

Propose phase not triggered. Only one viable implementation direction exists:

- Port 27017 detection via native shell primitives (`bash` TCP redirect or `nc` on Unix; `Test-NetConnection` on Windows)
- Read existing `.env` for credential defaults; fall back to hardcoded `dako`/`harness`
- Interactive credential prompting with defaults shown inline
- Post-write connection test via `mongosh --eval` or `node -e` (whichever is available)

No trade-offs between fundamentally different approaches — the change is a targeted augmentation of both existing scripts following the same logic flow.
