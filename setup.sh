#!/usr/bin/env bash
# DakoHarness setup script for Mac/Linux
# Usage: ./setup.sh [target-project-path]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_PATH="${1:-$PWD}"
ENV_PATH="$SCRIPT_DIR/mcps/mongodb-memory/.env"

echo ""
echo "DakoHarness Setup"
echo "================="

# 1. MongoDB — detect native or Docker
echo ""
echo "[1/5] MongoDB..."
if (echo >/dev/tcp/localhost/27017) 2>/dev/null; then
  echo "      Detected on port 27017 — skipping Docker."
else
  if ! docker info > /dev/null 2>&1; then
    echo "ERROR: MongoDB is not running on port 27017. Install Docker or start MongoDB first." >&2
    exit 1
  fi
  if docker ps --filter "name=mcp_mongodb" --format "{{.Names}}" | grep -q "mcp_mongodb"; then
    echo "      Docker container already running."
  else
    docker run -d \
      --name mcp_mongodb \
      -e MONGO_INITDB_ROOT_USERNAME=dako \
      -e MONGO_INITDB_ROOT_PASSWORD=harness \
      -p 27017:27017 \
      mongo:7 > /dev/null
    echo "      Container started."
  fi
fi

# 2. Credentials — prompt with defaults from existing .env or hardcoded fallback
echo ""
echo "[2/5] Credentials..."
DEFAULT_USER="dako"
DEFAULT_PASS="harness"
if [ -f "$ENV_PATH" ]; then
  line=$(grep "^MONGO_USER=" "$ENV_PATH" 2>/dev/null || true)
  [ -n "$line" ] && DEFAULT_USER="${line#MONGO_USER=}"
  line=$(grep "^MONGO_PASSWORD=" "$ENV_PATH" 2>/dev/null || true)
  [ -n "$line" ] && DEFAULT_PASS="${line#MONGO_PASSWORD=}"
fi

read -p "      MongoDB user [$DEFAULT_USER]: " INPUT_USER
MONGO_USER="${INPUT_USER:-$DEFAULT_USER}"

read -sp "      MongoDB password [$DEFAULT_PASS]: " INPUT_PASS
echo
MONGO_PASS="${INPUT_PASS:-$DEFAULT_PASS}"

MONGO_URI="mongodb://${MONGO_USER}:${MONGO_PASS}@localhost:27017/agent_memory?authSource=admin"

cat > "$ENV_PATH" <<EOF
MONGO_USER=$MONGO_USER
MONGO_PASSWORD=$MONGO_PASS
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=agent_memory
MONGO_URI=$MONGO_URI

DAKO_AGENT=claude-code
EOF
echo "      .env written to $ENV_PATH"

# 3. Test connection
echo ""
echo "[3/5] Testing connection..."
NM_PATH="$SCRIPT_DIR/mcps/mongodb-memory/node_modules"
if [ ! -d "$NM_PATH/mongodb" ]; then
  echo "      Skipping — run 'npm install --prefix mcps/mongodb-memory' first."
else
  if node -e "
const {MongoClient}=require('$NM_PATH/mongodb');
MongoClient.connect('$MONGO_URI',{serverSelectionTimeoutMS:3000})
  .then(c=>{c.close();process.exit(0)})
  .catch(()=>process.exit(1));
" 2>/dev/null; then
    echo "      Connected successfully."
  else
    echo "WARNING: Could not connect with provided credentials. Check your .env." >&2
  fi
fi

# 4. Write CLAUDE.md block
echo ""
echo "[4/5] Writing CLAUDE.md memory protocol to $PROJECT_PATH..."
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

# 5. Write hooks and MCP config
echo ""
echo "[5/5] Configuring hooks and MCP servers..."
SETTINGS_DIR="$PROJECT_PATH/.claude"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"
mkdir -p "$SETTINGS_DIR"

# Select platform binary and ensure executable
case "$(uname -s)" in
  Linux*)  STM_BIN="$SCRIPT_DIR/bin/dako-stm-linux" ;;
  Darwin*) STM_BIN="$SCRIPT_DIR/bin/dako-stm-darwin" ;;
  *)       STM_BIN="$SCRIPT_DIR/bin/dako-stm" ;;
esac
chmod +x "$STM_BIN" 2>/dev/null || true

if [ -f "$SETTINGS_FILE" ]; then
  echo "      .claude/settings.json already exists — add hooks manually:"
  echo "      \"node $SCRIPT_DIR/mcps/mongodb-memory/logger.mjs <event>\""
else
  cat > "$SETTINGS_FILE" <<EOF
{
  "hooks": {
    "UserPromptSubmit": [{"matcher": "", "hooks": [{"type": "command", "command": "node $SCRIPT_DIR/mcps/mongodb-memory/logger.mjs UserPromptSubmit"}]}],
    "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "node $SCRIPT_DIR/mcps/mongodb-memory/logger.mjs Stop"}]}],
    "PreCompact": [{"matcher": "", "hooks": [{"type": "command", "command": "node $SCRIPT_DIR/mcps/mongodb-memory/logger.mjs PreCompact"}]}],
    "SessionStart": []
  }
}
EOF
  echo "      .claude/settings.json written."
fi

cat > "$PROJECT_PATH/.mcp.json" <<EOF
{
  "mcpServers": {
    "dako-long-term-memory": {
      "command": "node",
      "args": ["$SCRIPT_DIR/mcps/mongodb-memory/server.js"]
    },
    "dako-short-term-memory": {
      "command": "$STM_BIN",
      "env": {
        "DAKO_PROJECT_ROOT": "$PROJECT_PATH"
      }
    }
  }
}
EOF
echo "      .mcp.json written."

echo ""
echo "Setup complete."
echo "Next: run 'claude --plugin-dir \"$SCRIPT_DIR\"' in your project directory."
