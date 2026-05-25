#!/usr/bin/env node
/**
 * logger.mjs — CLI companion for DakoHarness session logging.
 *
 * Called by Claude Code hooks via stdin JSON payload.
 * Routes session writes through the storage abstraction — backend is determined
 * by DAKO_STORAGE_BACKEND (default: mongodb), same as server.js.
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
 *   DAKO_STORAGE_BACKEND — "mongodb" (default) or "sqlite"
 *   MONGO_URI            — MongoDB connection string (falls back to docker-compose default)
 *   DAKO_SQLITE_PATH     — SQLite DB path (falls back to .dako/memory.db)
 *   DAKO_PROJECT         — project name override (falls back to cwd basename)
 *   DAKO_AGENT           — agent name override (default: "claude-code")
 *   DAKO_SESSION_FILE    — path to persist the session_id across hook invocations
 *                          (default: <cwd>/.claude/.dako_session)
 */

import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, basename } from "path";
import { createInterface } from "readline";
import dotenv from "dotenv";
import { getStorage, closeStorage } from "./storage/factory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

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
const agentName = process.env.DAKO_AGENT || "claude-code";
const sessionFile = getSessionFile(cwd);

try {
  const storage = await getStorage();

  // Ensure or create session, detecting new conversations via Claude Code's session_id
  const { session_id: storedSessionId, claude_session_id: storedClaudeSessionId } = loadSessionState(sessionFile);

  const isNewConversation = Boolean(
    claudeSessionId && storedClaudeSessionId && claudeSessionId !== storedClaudeSessionId
  );

  let session_id;
  if (!storedSessionId || isNewConversation) {
    session_id = randomUUID();
    // startSession with caller-supplied session_id so both branches use the same ID
    await storage.startSession({
      session_id,
      project: projectName,
      agent: agentName,
      cwd,
    });
    saveSessionState(sessionFile, session_id, claudeSessionId);
  } else {
    session_id = storedSessionId;
    if (claudeSessionId && !storedClaudeSessionId) {
      saveSessionState(sessionFile, session_id, claudeSessionId);
    }
  }

  if (event === "UserPromptSubmit") {
    const content = payload.prompt || payload.message || "(no content)";
    await storage.logMessage({ session_id, role: "user", content });

  } else if (event === "Stop") {
    const transcriptPath = payload.transcript_path;
    let content = "(transcript unavailable)";

    if (transcriptPath && existsSync(transcriptPath)) {
      const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === "assistant" || entry.role === "assistant") {
            const msg = entry.message ?? entry;
            const rawContent = msg.content ?? "";
            content = typeof rawContent === "string"
              ? rawContent
              : Array.isArray(rawContent)
                ? rawContent.filter(b => b.type === "text").map(b => b.text).join("\n")
                : JSON.stringify(rawContent);
            break;
          }
        } catch {}
      }
    }

    await storage.logMessage({ session_id, role: "assistant", content });

  } else {
    process.stderr.write(`Unknown event: ${event}\n`);
  }

} finally {
  // closeStorage() is idempotent: Mongo closes its client; SQLite no-op
  await closeStorage();
}
