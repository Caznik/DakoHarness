---
name: setup
description: Configure DakoHarness for the current project — sets DAKO_PROJECT_ROOT in the project MCP config.
---

## When to use
Once after installing the dako plugin in a new project. Sets the project root so the short-term memory MCP knows which project it is serving.

## Steps

1. **Determine the project root**
   - Use the current working directory as `DAKO_PROJECT_ROOT`
   - Show the path to the user and confirm: "Configure DakoHarness for **<path>**?"

2. **Read or create project `.mcp.json`**
   - If `.mcp.json` exists in cwd: read it, preserve all existing entries
   - If not: start with an empty `mcpServers` object

3. **Write the short-term memory entry**
   Update or add `dako-short-term-memory` with `DAKO_PROJECT_ROOT` set to the confirmed path:
   ```json
   "dako-short-term-memory": {
     "command": "dako-stm",
     "env": {
       "DAKO_PROJECT_ROOT": "<confirmed-path>"
     }
   }
   ```

4. **Write `.mcp.json`** — preserving all other entries

5. **Report**
   "DakoHarness configured for **<path>**. Restart Claude Code to activate the short-term memory MCP."
