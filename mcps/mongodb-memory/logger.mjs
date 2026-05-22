#!/usr/bin/env node
/**
 * logger.mjs — CLI companion for DakoHarness session logging.
 *
 * Called by Claude Code hooks via stdin JSON payload.
 * Writes session messages directly to MongoDB (no MCP overhead).
 *
 * Usage (from hooks):
 *   echo '<hook-json>' | node logger.mjs <event>
 *
 * Supported events:
 *   UserPromptSubmit  — logs the user's prompt as a "user" message
 *   Stop              — reads the last assistant turn from the transcript and logs it
 *
 * Note: PreCompact is intentionally not handled. Compaction recovery uses STM snapshots
 * saved by the agent via /dako:checkpoint or the periodic turn-count rule in CLAUDE.md.
 *
 * Environment:
 *   MONGO_URI         — MongoDB connection string (falls back to docker-compose default)
 *   DAKO_PROJECT      — project name override (falls back to cwd basename)
 *   DAKO_AGENT        — agent name override (default: "claude-code")
 *   DAKO_SESSION_FILE — path to persist the session_id across hook invocations
 *                       (default: <cwd>/.claude/.dako_session)
 */

import { MongoClient, ServerApiVersion } from "mongodb";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";
import { createInterface } from "readline";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

const {
  MONGO_URI,
  MONGO_USER = "dako",
  MONGO_PASSWORD = "harness",
  MONGO_HOST = "localhost",
  MONGO_PORT = "27017",
  MONGO_DB: MONGO_DB_ENV = "agent_memory",
} = process.env;

const mongoUri = MONGO_URI ||
  `mongodb://${MONGO_USER}:${MONGO_PASSWORD}@${MONGO_HOST}:${MONGO_PORT}/${MONGO_DB_ENV}?authSource=admin`;

const DB_NAME = process.env.MONGO_DB || "agent_memory";
const SESSIONS_COL = "sessions";
const MESSAGES_COL = "messages";

// ── helpers ──────────────────────────────────────────────────────────────────

function readStdin() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    const lines = [];
    rl.on("line", (l) => lines.push(l));
    rl.on("close", () => resolve(lines.join("\n")));
  });
}

function getSessionFile(cwd) {
  if (process.env.DAKO_SESSION_FILE) return process.env.DAKO_SESSION_FILE;
  const claudeDir = join(cwd, ".claude");
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
  return join(claudeDir, ".dako_session");
}

function loadSessionState(sessionFile) {
  if (existsSync(sessionFile)) {
    try {
      const data = JSON.parse(readFileSync(sessionFile, "utf8"));
      return { session_id: data.session_id || null, claude_session_id: data.claude_session_id || null };
    } catch {}
  }
  return { session_id: null, claude_session_id: null };
}

function saveSessionState(sessionFile, session_id, claude_session_id) {
  writeFileSync(sessionFile, JSON.stringify({ session_id, claude_session_id }), "utf8");
}

// ── main ─────────────────────────────────────────────────────────────────────

const event = process.argv[2];
if (!event) {
  process.stderr.write("Usage: node logger.mjs <UserPromptSubmit|Stop>\n");
  process.exit(1);
}

const raw = await readStdin();
let payload = {};
try { payload = JSON.parse(raw); } catch {}

const cwd = payload.cwd || process.cwd();
const claudeSessionId = payload.session_id || null;
const projectName = process.env.DAKO_PROJECT || basename(cwd);
const agentName = process.env.DAKO_AGENT || "claude-code"; // override in .env
const sessionFile = getSessionFile(cwd);

const mongo = new MongoClient(mongoUri, { serverApi: ServerApiVersion.v1 });

try {
  await mongo.connect();
  const db = mongo.db(DB_NAME);
  const sessions = db.collection(SESSIONS_COL);
  const messages = db.collection(MESSAGES_COL);

  // Ensure or create session, detecting new conversations via Claude Code's session_id
  const { session_id: storedSessionId, claude_session_id: storedClaudeSessionId } = loadSessionState(sessionFile);

  const isNewConversation = Boolean(
    claudeSessionId && storedClaudeSessionId && claudeSessionId !== storedClaudeSessionId
  );

  let session_id;
  if (!storedSessionId || isNewConversation) {
    session_id = randomUUID();
    await sessions.insertOne({
      session_id,
      project: projectName,
      agent: agentName,
      cwd,
      started_at: new Date(),
    });
    saveSessionState(sessionFile, session_id, claudeSessionId);
  } else {
    session_id = storedSessionId;
    if (claudeSessionId && !storedClaudeSessionId) {
      saveSessionState(sessionFile, session_id, claudeSessionId);
    }
  }

  if (event === "UserPromptSubmit") {
    // payload.prompt contains the submitted user message
    const content = payload.prompt || payload.message || "(no content)";
    const seq = await messages.countDocuments({ session_id });
    await messages.insertOne({ session_id, role: "user", content, seq, timestamp: new Date() });

  } else if (event === "Stop") {
    // Read last assistant message from the JSONL transcript
    const transcriptPath = payload.transcript_path;
    let content = "(transcript unavailable)";

    if (transcriptPath && existsSync(transcriptPath)) {
      const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");
      // Walk backwards to find the last assistant turn
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === "assistant" || entry.role === "assistant") {
            // Claude Code JSONL wraps the API response under entry.message;
            // fall back to entry itself for simpler formats
            const msg = entry.message ?? entry;
            const raw = msg.content ?? "";
            content = typeof raw === "string"
              ? raw
              : Array.isArray(raw)
                ? raw.filter(b => b.type === "text").map(b => b.text).join("\n")
                : JSON.stringify(raw);
            break;
          }
        } catch {}
      }
    }

    const seq = await messages.countDocuments({ session_id });
    await messages.insertOne({ session_id, role: "assistant", content, seq, timestamp: new Date() });

  } else {
    process.stderr.write(`Unknown event: ${event}\n`);
  }

} finally {
  await mongo.close();
}
