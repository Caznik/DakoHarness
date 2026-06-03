#!/usr/bin/env bash
# DakoHarness — OpenCode adapter setup (Mac/Linux)
#
# One-stop, interactive installer. Run it with no arguments and it asks for
# everything it needs:
#   ./setup.sh
# Or pre-answer the project path:
#   ./setup.sh /path/to/your/project
#
# Configures an OpenCode project end-to-end:
#   - chosen storage backend (MongoDB or SQLite) + shared .env
#   - opencode.json (MCP registrations + AGENTS.md instruction)
#   - .opencode/plugins/dako-logger.js + .opencode/dako.config.json
#   - .opencode/commands/ + .opencode/agents/  (project-level or global)
#   - AGENTS.md memory protocol
set -euo pipefail

ADAPTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # adapters/opencode
HARNESS_ROOT="$(cd "$ADAPTER_DIR/../.." && pwd)"             # repo root
ENV_PATH="$HARNESS_ROOT/mcps/mongodb-memory/.env"
PROJECT_PATH="${1:-}"

echo ""
echo "DakoHarness — OpenCode adapter setup"
echo "===================================="
echo "Harness root : $HARNESS_ROOT"

# ── 0. Resolve target project path (ask if needed) ───────────────────────────
while [ -z "$PROJECT_PATH" ] || [ ! -d "$PROJECT_PATH" ]; do
  [ -n "$PROJECT_PATH" ] && echo "      Path not found: $PROJECT_PATH" >&2
  read -p "Path to the project to configure: " PROJECT_PATH
done
PROJECT_PATH="$(cd "$PROJECT_PATH" && pwd)"
PROJECT_NAME="$(basename "$PROJECT_PATH")"
echo "Project      : $PROJECT_PATH"

# ── 0b. Storage backend ──────────────────────────────────────────────────────
echo ""
echo "Storage backend:"
echo "  [1] mongodb (default) — permanent, team-shareable; needs MongoDB/Docker"
echo "  [2] sqlite            — self-contained; no database server"
read -p "Choice [1]: " BC
if [ "$BC" = "2" ]; then BACKEND="sqlite"; else BACKEND="mongodb"; fi
echo "Backend      : $BACKEND"

# ── 0c. Commands/agents scope ────────────────────────────────────────────────
echo ""
echo "Install slash commands + subagent for:"
echo "  [1] this project only (default) — <project>/.opencode/"
echo "  [2] all projects (global)       — ~/.config/opencode/"
read -p "Choice [1]: " SC
if [ "$SC" = "2" ]; then SCOPE="global"; else SCOPE="project"; fi

# ── platform STM binary ──────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux*)  STM_BIN="$HARNESS_ROOT/bin/dako-stm-linux" ;;
  Darwin*) STM_BIN="$HARNESS_ROOT/bin/dako-stm-darwin" ;;
  *)       STM_BIN="$HARNESS_ROOT/bin/dako-stm" ;;
esac
chmod +x "$STM_BIN" 2>/dev/null || true

# ── 1. Node deps ─────────────────────────────────────────────────────────────
echo ""
echo "[1/7] Node dependencies..."
NM_PATH="$HARNESS_ROOT/mcps/mongodb-memory/node_modules"
if [ -d "$NM_PATH/@modelcontextprotocol" ]; then
  echo "      Already installed."
else
  read -p "      Dependencies not installed. Run 'npm install' now? [Y/n]: " A
  if [[ ! "$A" =~ ^[Nn] ]]; then
    npm install --prefix "$HARNESS_ROOT/mcps/mongodb-memory"
    echo "      Installed."
  else
    echo "      Skipped — MCPs will not run until you run 'npm install --prefix mcps/mongodb-memory'."
  fi
fi

# ── 2-4. Backend config ──────────────────────────────────────────────────────
if [ "$BACKEND" = "mongodb" ]; then
  echo ""
  echo "[2/7] MongoDB..."
  if (echo >/dev/tcp/localhost/27017) 2>/dev/null; then
    echo "      Detected on port 27017 — skipping Docker."
  else
    if ! docker info > /dev/null 2>&1; then
      echo "ERROR: MongoDB is not running on port 27017 and Docker is unavailable." >&2
      echo "       Re-run choosing the sqlite backend, or start MongoDB/Docker first." >&2
      exit 1
    fi
    if docker ps --filter "name=mcp_mongodb" --format "{{.Names}}" | grep -q "mcp_mongodb"; then
      echo "      Docker container already running."
    else
      docker run -d --name mcp_mongodb \
        -e MONGO_INITDB_ROOT_USERNAME=dako \
        -e MONGO_INITDB_ROOT_PASSWORD=harness \
        -p 27017:27017 mongo:7 > /dev/null
      echo "      Container started."
    fi
  fi

  echo ""
  echo "[3/7] Credentials (.env)..."
  DEFAULT_USER="dako"; DEFAULT_PASS="harness"
  if [ -f "$ENV_PATH" ]; then
    line=$(grep "^MONGO_USER=" "$ENV_PATH" 2>/dev/null || true);     [ -n "$line" ] && DEFAULT_USER="${line#MONGO_USER=}"
    line=$(grep "^MONGO_PASSWORD=" "$ENV_PATH" 2>/dev/null || true); [ -n "$line" ] && DEFAULT_PASS="${line#MONGO_PASSWORD=}"
  fi
  read -p "      MongoDB user [$DEFAULT_USER]: " INPUT_USER
  MONGO_USER="${INPUT_USER:-$DEFAULT_USER}"
  read -sp "      MongoDB password [$DEFAULT_PASS]: " INPUT_PASS; echo
  MONGO_PASS="${INPUT_PASS:-$DEFAULT_PASS}"
  MONGO_URI="mongodb://${MONGO_USER}:${MONGO_PASS}@localhost:27017/agent_memory?authSource=admin"

  cat > "$ENV_PATH" <<EOF
MONGO_USER=$MONGO_USER
MONGO_PASSWORD=$MONGO_PASS
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=agent_memory
MONGO_URI=$MONGO_URI

DAKO_AGENT=opencode
DAKO_STORAGE_BACKEND=mongodb
EOF
  echo "      .env written to $ENV_PATH"

  echo ""
  echo "[4/7] Testing connection..."
  if [ ! -d "$NM_PATH/mongodb" ]; then
    echo "      Skipping — node deps not installed."
  else
    if node -e "
const {MongoClient}=require('$NM_PATH/mongodb');
MongoClient.connect('$MONGO_URI',{serverSelectionTimeoutMS:3000})
  .then(c=>{c.close();process.exit(0)}).catch(()=>process.exit(1));
" 2>/dev/null; then
      echo "      Connected successfully."
    else
      echo "WARNING: Could not connect. Check your .env." >&2
    fi
  fi
else
  echo ""
  echo "[2-4/7] SQLite backend — writing .env (no MongoDB needed)..."
  cat > "$ENV_PATH" <<EOF
DAKO_STORAGE_BACKEND=sqlite
DAKO_SQLITE_PATH=.dako/memory.db
DAKO_AGENT=opencode
EOF
  echo "      .env written to $ENV_PATH"
fi

# ── 5. opencode.json ─────────────────────────────────────────────────────────
echo ""
echo "[5/7] Writing opencode.json..."
SERVER_PATH="$HARNESS_ROOT/mcps/mongodb-memory/server.js"
OPENCODE_JSON="$PROJECT_PATH/opencode.json"
if [ -f "$OPENCODE_JSON" ]; then
  echo "      opencode.json already exists — ensure it contains these mcp entries:"
  echo "        dako-long-term-memory  -> node $SERVER_PATH"
  echo "        dako-short-term-memory -> $STM_BIN (env DAKO_PROJECT_ROOT=$PROJECT_PATH)"
else
  cat > "$OPENCODE_JSON" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "dako-long-term-memory": {
      "type": "local",
      "command": ["node", "$SERVER_PATH"],
      "enabled": true,
      "environment": { "DAKO_AGENT": "opencode" }
    },
    "dako-short-term-memory": {
      "type": "local",
      "command": ["$STM_BIN"],
      "enabled": true,
      "environment": { "DAKO_PROJECT_ROOT": "$PROJECT_PATH" }
    }
  },
  "instructions": ["AGENTS.md"]
}
EOF
  echo "      opencode.json written."
fi

# ── 6. Plugin + config + commands + agents ───────────────────────────────────
echo ""
echo "[6/7] Installing plugin, commands, and subagent..."
OPENCODE_DIR="$PROJECT_PATH/.opencode"
mkdir -p "$OPENCODE_DIR/plugins"
cp "$ADAPTER_DIR/.opencode/plugins/dako-logger.js" "$OPENCODE_DIR/plugins/dako-logger.js"
echo "      dako-logger.js installed."

cat > "$OPENCODE_DIR/dako.config.json" <<EOF
{
  "harnessRoot": "$HARNESS_ROOT",
  "project": "$PROJECT_NAME",
  "agent": "opencode"
}
EOF
echo "      dako.config.json written to .opencode/"

if [ "$SCOPE" = "global" ]; then
  CMD_TARGET="$HOME/.config/opencode/commands"
  AGT_TARGET="$HOME/.config/opencode/agents"
else
  CMD_TARGET="$OPENCODE_DIR/commands"
  AGT_TARGET="$OPENCODE_DIR/agents"
fi
mkdir -p "$CMD_TARGET" "$AGT_TARGET"
cp -R "$ADAPTER_DIR/.opencode/commands/." "$CMD_TARGET/"
cp "$ADAPTER_DIR/.opencode/skill-registry.md" "$OPENCODE_DIR/"
cp -R "$ADAPTER_DIR/.opencode/agents/." "$AGT_TARGET/"
echo "      commands -> $CMD_TARGET"
echo "      agents   -> $AGT_TARGET"

# ── 7. AGENTS.md ─────────────────────────────────────────────────────────────
echo ""
echo "[7/7] Writing AGENTS.md memory protocol to $PROJECT_PATH..."
AGENTS_MD="$PROJECT_PATH/AGENTS.md"
BLOCK='
---

## DakoHarness — Memory Protocol

You have two memory systems. Use them actively.

### Session Start

Start every session blank. Do **not** preload memory. Wait for the user'\''s first task, then decide if memory is relevant.

**After compaction:** Call `find_patterns` with query `context-snapshot` for this project to recover where work was interrupted.

### During a Session — When to Search

- Call `find_patterns` with task keywords if the task feels like something done recently
- Call `recall` with keywords if you need a past decision or convention
- Do not search memory for tasks clearly unrelated to past work

### During a Session — When to Save

**Short-term** (`remember_pattern`): user accepts an approach, bug fixed with reusable pattern, convention established.
**Long-term** (`remember`): architectural decision, permanent convention, systemic bug lesson, important project fact.

Session transcripts are captured automatically by the dako-logger plugin — you do not need to log messages manually.
'
if [ -f "$AGENTS_MD" ]; then
  if grep -q "DakoHarness — Memory Protocol" "$AGENTS_MD"; then
    echo "      AGENTS.md already contains the block — skipping."
  else
    echo "$BLOCK" >> "$AGENTS_MD"
    echo "      Appended to existing AGENTS.md"
  fi
else
  echo "$BLOCK" > "$AGENTS_MD"
  echo "      Created AGENTS.md"
fi

echo ""
echo "Setup complete."
echo "Next:"
echo "  cd \"$PROJECT_PATH\""
echo "  opencode"
echo "  then run  /doctor  (full health check) and  /recall test  (verify MCPs)."
