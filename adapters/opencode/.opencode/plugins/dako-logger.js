/**
 * dako-logger — OpenCode plugin for DakoHarness session logging.
 *
 * This is the OpenCode equivalent of the Claude Code hook chain
 * (UserPromptSubmit / Stop / PreCompact). OpenCode has no settings.json hooks;
 * instead a plugin subscribes to the event bus:
 *
 *   chat.message                      → logs the user's prompt   (role: "user")
 *   event: message.updated / .part.updated / session.idle
 *                                     → captures the assistant turn and logs it
 *                                       once the session goes idle (role: "assistant")
 *   experimental.session.compacting   → injects a recovery hint before compaction
 *
 * Persistence is delegated to the shared, agent-agnostic logger.mjs that ships
 * with the long-term memory MCP, so OpenCode writes sessions/messages through the
 * exact same storage backend (DAKO_STORAGE_BACKEND) as Claude Code does.
 *
 * Locating the harness:
 *   1. DAKO_HARNESS_ROOT env var, if set
 *   2. harnessRoot field in a sibling dako.config.json (written by setup)
 *   3. fallback: resolved relative to this file inside the repo
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readConfig() {
  // Prefer .opencode/dako.config.json (one level up — OpenCode scans plugins/ for
  // plugin modules, so config lives outside it). Fall back to a sibling for compat.
  const candidates = [
    join(__dirname, "..", "dako.config.json"),
    join(__dirname, "dako.config.json"),
  ];
  for (const cfgPath of candidates) {
    if (existsSync(cfgPath)) {
      try {
        // strip a leading UTF-8 BOM — Windows editors / PowerShell may add one.
        return JSON.parse(readFileSync(cfgPath, "utf8").replace(/^﻿/, ""));
      } catch {}
    }
  }
  return {};
}

const CFG = readConfig();

function harnessRoot() {
  if (process.env.DAKO_HARNESS_ROOT) return process.env.DAKO_HARNESS_ROOT;
  if (CFG.harnessRoot) return CFG.harnessRoot;
  // adapters/opencode/.opencode/plugins → repo root
  return resolve(__dirname, "..", "..", "..", "..");
}

const LOGGER_PATH =
  process.env.DAKO_LOGGER_PATH ||
  join(harnessRoot(), "mcps", "mongodb-memory", "logger.mjs");

function partsToText(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

function runLogger(event, payload, projectDir) {
  return new Promise((res) => {
    let child;
    try {
      child = spawn("node", [LOGGER_PATH, event], {
        env: {
          ...process.env,
          DAKO_AGENT: CFG.agent || "opencode",
          ...(CFG.project ? { DAKO_PROJECT: CFG.project } : {}),
          // Keep OpenCode session state separate from any Claude Code state.
          DAKO_SESSION_FILE: join(projectDir, ".opencode", ".dako_session"),
        },
        stdio: ["pipe", "ignore", "ignore"],
      });
    } catch {
      return res();
    }
    child.on("error", () => res());
    child.on("close", () => res());
    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch {
      res();
    }
  });
}

export const DakoLogger = async ({ directory, worktree }) => {
  const projectDir = directory || worktree || process.cwd();

  // Assistant turns stream in as parts. We only know a message is the assistant's
  // from a message.updated event (role === "assistant"), so we track which message
  // IDs are assistant-owned, accumulate their text parts, and flush on session.idle.
  const assistantMsgIds = new Set();
  const partsByMessage = new Map(); // messageID -> Map<partID, text>
  const lastAssistantBySession = new Map(); // sessionID -> messageID

  return {
    // ── user prompt ────────────────────────────────────────────────────────
    "chat.message": async (input, output) => {
      try {
        const sessionID = output?.message?.sessionID || input?.sessionID;
        const text = partsToText(output?.parts);
        if (sessionID && text) {
          await runLogger(
            "UserPromptSubmit",
            { session_id: sessionID, cwd: projectDir, prompt: text },
            projectDir,
          );
        }
      } catch {}
    },

    // ── assistant turn (event bus) ─────────────────────────────────────────
    event: async ({ event }) => {
      try {
        const type = event?.type;
        const props = event?.properties || {};

        if (type === "message.updated") {
          const info = props.info;
          if (info?.role === "assistant" && info?.id) {
            assistantMsgIds.add(info.id);
            if (!partsByMessage.has(info.id)) partsByMessage.set(info.id, new Map());
            if (info.sessionID) lastAssistantBySession.set(info.sessionID, info.id);
          }
        } else if (type === "message.part.updated") {
          const part = props.part;
          if (
            part?.type === "text" &&
            part.messageID &&
            assistantMsgIds.has(part.messageID)
          ) {
            const m = partsByMessage.get(part.messageID) || new Map();
            // part updates are cumulative for a given part id — overwrite, don't append.
            m.set(part.id ?? part.partID ?? "0", part.text || "");
            partsByMessage.set(part.messageID, m);
          }
        } else if (type === "session.idle") {
          const sessionID = props.sessionID;
          const msgId = sessionID ? lastAssistantBySession.get(sessionID) : null;
          if (msgId && partsByMessage.has(msgId)) {
            const text = Array.from(partsByMessage.get(msgId).values()).join("");
            partsByMessage.delete(msgId);
            assistantMsgIds.delete(msgId);
            if (sessionID) lastAssistantBySession.delete(sessionID);
            if (text) {
              await runLogger(
                "Stop",
                { session_id: sessionID, cwd: projectDir, content: text },
                projectDir,
              );
            }
          }
        }
      } catch {}
    },

    // ── compaction recovery hint ───────────────────────────────────────────
    "experimental.session.compacting": async (_input, output) => {
      try {
        output.context.push(
          "## DakoHarness recovery\n" +
            "After this compaction, call find_patterns with query \"context-snapshot\" " +
            "for this project to recover where work was interrupted.",
        );
      } catch {}
    },
  };
};
