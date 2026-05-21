#!/usr/bin/env bash
# DakoHarness setup script for Mac/Linux
# Usage: ./setup.sh [target-project-path]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="${1:-$PWD}"

echo ""
echo "DakoHarness Setup"
echo "================="

# 1. Check Docker
echo ""
echo "[1/4] Checking Docker..."
if ! docker info > /dev/null 2>&1; then
  echo "ERROR: Docker is not running. Start Docker and re-run this script." >&2
  exit 1
fi
echo "      Docker is running."

# 2. Start MongoDB
echo ""
echo "[2/4] Starting MongoDB..."
if docker ps --filter "name=mcp_mongodb" --format "{{.Names}}" | grep -q "mcp_mongodb"; then
  echo "      MongoDB container already running — skipping."
else
  docker run -d \
    --name mcp_mongodb \
    -e MONGO_INITDB_ROOT_USERNAME=dako \
    -e MONGO_INITDB_ROOT_PASSWORD=harness \
    -p 27017:27017 \
    mongo:7 > /dev/null
  echo "      MongoDB started."
fi

# 3. Create .env
echo ""
echo "[3/4] Creating .env..."
ENV_PATH="$SCRIPT_DIR/mcps/mongodb-memory/.env"
if [ -f "$ENV_PATH" ]; then
  echo "      .env already exists — skipping."
else
  cat > "$ENV_PATH" <<EOF
MONGO_USER=dako
MONGO_PASSWORD=harness
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=agent_memory
MONGO_URI=mongodb://dako:harness@localhost:27017/agent_memory?authSource=admin

DAKO_AGENT=claude-code
EOF
  echo "      .env created at $ENV_PATH"
fi

# 4. Write CLAUDE.md block
echo ""
echo "[4/4] Writing CLAUDE.md memory protocol to $PROJECT_PATH..."
CLAUDE_MD="$PROJECT_PATH/CLAUDE.md"
BLOCK='
---

## DakoHarness — Memory Protocol

You have two memory systems. Use them actively.

### Session Start

Start every session blank. Do **not** preload memory. Wait for the user'\''s first task, then decide if memory is relevant.

**After compaction:** Call `get_context` once to check for compaction snapshots (tag `auto-cleanup`). If found, read to understand where work was interrupted, then delete with `forget`.

### During a Session — When to Search

- Call `find_patterns` with task keywords if the task feels like something done recently
- Call `recall` with keywords if you need a past decision or convention
- Do not search memory for tasks clearly unrelated to past work

### During a Session — When to Save

**Short-term** (`remember_pattern`): user accepts an approach, bug fixed with reusable pattern, convention established.
**Long-term** (`remember`): architectural decision, permanent convention, systemic bug lesson, important project fact.

### Tool Reference

| Situation | Tool |
|---|---|
| After compaction — check snapshot | `get_context` |
| User accepts an approach | `remember_pattern` |
| Architectural decision | `remember` type: decision |
| Convention established | `remember` type: convention |
| Bug fixed | `remember` type: bug |
| Before similar task | `find_patterns` |
| Searching past decisions | `recall` |
'

if [ -f "$CLAUDE_MD" ]; then
  echo "$BLOCK" >> "$CLAUDE_MD"
  echo "      Appended to existing CLAUDE.md"
else
  echo "$BLOCK" > "$CLAUDE_MD"
  echo "      Created CLAUDE.md"
fi

echo ""
echo "Setup complete."
echo "Next: run 'claude --plugin-dir $SCRIPT_DIR' and then '/dako:setup' in your project."
