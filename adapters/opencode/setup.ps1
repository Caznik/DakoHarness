#!/usr/bin/env pwsh
# DakoHarness — OpenCode adapter setup (Windows / PowerShell)
#
# One-stop, interactive installer. Run it with no arguments and it will ask for
# everything it needs:
#   .\setup.ps1
# Or pre-answer the project path:
#   .\setup.ps1 -ProjectPath "C:\path\to\your\project"
#
# It configures an OpenCode project end-to-end:
#   - chosen storage backend (MongoDB or SQLite) + shared .env
#   - opencode.json (MCP registrations + AGENTS.md instruction)
#   - .opencode/plugins/dako-logger.js + .opencode/dako.config.json
#   - .opencode/commands/ + .opencode/agents/  (project-level or global)
#   - AGENTS.md memory protocol
param(
  [string]$ProjectPath = "",
  [ValidateSet("", "mongodb", "sqlite")]
  [string]$Backend = "",
  [ValidateSet("", "project", "global")]
  [string]$CommandsScope = ""
)

$ErrorActionPreference = "Stop"
$AdapterDir  = Split-Path -Parent $MyInvocation.MyCommand.Path        # adapters/opencode
$HarnessRoot = Split-Path -Parent (Split-Path -Parent $AdapterDir)   # repo root
$EnvPath     = Join-Path $HarnessRoot "mcps\mongodb-memory\.env"
$HarnessFwd  = $HarnessRoot -replace '\\', '/'

# Set-Content -Encoding utf8 adds a BOM on PS 5.1, which breaks Node's JSON.parse
# and can confuse dotenv. Write all consumed files as BOM-less UTF-8.
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}
function Append-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::AppendAllText($Path, $Content, $Utf8NoBom)
}

Write-Host "`nDakoHarness — OpenCode adapter setup" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Harness root : $HarnessRoot"

# ── 0. Resolve target project path (ask if needed) ───────────────────────────
while (-not $ProjectPath -or -not (Test-Path -PathType Container $ProjectPath)) {
  if ($ProjectPath) {
    Write-Host "      Path not found: $ProjectPath" -ForegroundColor Red
  }
  $ProjectPath = Read-Host "Path to the project to configure"
  $ProjectPath = $ProjectPath.Trim('"').Trim()
}
$ProjectPath = (Resolve-Path $ProjectPath).Path
$ProjectFwd  = $ProjectPath -replace '\\', '/'
$ProjectName = Split-Path -Leaf $ProjectPath
Write-Host "Project      : $ProjectPath"

# ── 0b. Choose storage backend (ask if needed) ──────────────────────────────
if (-not $Backend) {
  Write-Host "`nStorage backend:" -ForegroundColor Yellow
  Write-Host "  [1] mongodb (default) — permanent, team-shareable; needs MongoDB/Docker"
  Write-Host "  [2] sqlite            — self-contained; no database server"
  $choice = Read-Host "Choice [1]"
  $Backend = if ($choice -eq "2") { "sqlite" } else { "mongodb" }
}
Write-Host "Backend      : $Backend"

# ── 0c. Choose where commands/agents go (ask if needed) ─────────────────────
if (-not $CommandsScope) {
  Write-Host "`nInstall slash commands + subagent for:" -ForegroundColor Yellow
  Write-Host "  [1] this project only (default) — <project>/.opencode/"
  Write-Host "  [2] all projects (global)       — ~/.config/opencode/"
  $choice = Read-Host "Choice [1]"
  $CommandsScope = if ($choice -eq "2") { "global" } else { "project" }
}

# ── 1. Node deps (ask to install if missing) ─────────────────────────────────
Write-Host "`n[1/7] Node dependencies..." -ForegroundColor Yellow
$NmPath = Join-Path $HarnessRoot "mcps\mongodb-memory\node_modules"
if (Test-Path (Join-Path $NmPath "@modelcontextprotocol")) {
  Write-Host "      Already installed." -ForegroundColor Green
} else {
  $ans = Read-Host "      Dependencies not installed. Run 'npm install' now? [Y/n]"
  if ($ans -notmatch '^[Nn]') {
    Push-Location $HarnessRoot
    npm install --prefix mcps/mongodb-memory
    Pop-Location
    Write-Host "      Installed." -ForegroundColor Green
  } else {
    Write-Host "      Skipped — MCPs will not run until you run 'npm install --prefix mcps/mongodb-memory'." -ForegroundColor Yellow
  }
}

# ── 2. MongoDB + credentials, or SQLite .env ─────────────────────────────────
if ($Backend -eq "mongodb") {
  Write-Host "`n[2/7] MongoDB..." -ForegroundColor Yellow
  $mongoDetected = $false
  try {
    $tcpTest = Test-NetConnection -ComputerName localhost -Port 27017 -InformationLevel Quiet -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
    if ($tcpTest) {
      Write-Host "      Detected on port 27017 — skipping Docker." -ForegroundColor Green
      $mongoDetected = $true
    }
  } catch {}

  if (-not $mongoDetected) {
    try {
      docker info 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Docker not running" }
    } catch {
      Write-Host "ERROR: MongoDB is not running on port 27017 and Docker is unavailable." -ForegroundColor Red
      Write-Host "       Re-run choosing the sqlite backend, or start MongoDB/Docker first." -ForegroundColor Yellow
      exit 1
    }
    $running = docker ps --filter "name=mcp_mongodb" --format "{{.Names}}" 2>&1
    if ($running -match "mcp_mongodb") {
      Write-Host "      Docker container already running." -ForegroundColor Green
    } else {
      docker run -d `
        --name mcp_mongodb `
        -e MONGO_INITDB_ROOT_USERNAME=dako `
        -e MONGO_INITDB_ROOT_PASSWORD=harness `
        -p 27017:27017 `
        mongo:7 | Out-Null
      Write-Host "      Container started." -ForegroundColor Green
    }
  }

  Write-Host "`n[3/7] Credentials (.env)..." -ForegroundColor Yellow
  $DefaultUser = "dako"; $DefaultPass = "harness"
  if (Test-Path $EnvPath) {
    $envLines = Get-Content $EnvPath
    $userLine = $envLines | Where-Object { $_ -match "^MONGO_USER=" } | Select-Object -First 1
    $passLine = $envLines | Where-Object { $_ -match "^MONGO_PASSWORD=" } | Select-Object -First 1
    if ($userLine) { $DefaultUser = $userLine.Split("=", 2)[1] }
    if ($passLine) { $DefaultPass = $passLine.Split("=", 2)[1] }
  }
  $inputUser = Read-Host "      MongoDB user [$DefaultUser]"
  $MongoUser = if ($inputUser) { $inputUser } else { $DefaultUser }
  $securePass = Read-Host "      MongoDB password [$DefaultPass]" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
  $inputPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  $MongoPass = if ($inputPass) { $inputPass } else { $DefaultPass }
  $MongoUri = "mongodb://${MongoUser}:${MongoPass}@localhost:27017/agent_memory?authSource=admin"

  $EnvContent = @"
MONGO_USER=$MongoUser
MONGO_PASSWORD=$MongoPass
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=agent_memory
MONGO_URI=$MongoUri

DAKO_AGENT=opencode
DAKO_STORAGE_BACKEND=mongodb
"@
  Write-Utf8NoBom $EnvPath $EnvContent
  Write-Host "      .env written to $EnvPath" -ForegroundColor Green

  Write-Host "`n[4/7] Testing connection..." -ForegroundColor Yellow
  if (-not (Test-Path (Join-Path $NmPath "mongodb"))) {
    Write-Host "      Skipping — node deps not installed." -ForegroundColor Yellow
  } else {
    $NmPathFwd = (Join-Path $NmPath "mongodb") -replace '\\', '/'
    $tmpJs = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.js'
    $jsContent = 'var MC=require(' + "'" + $NmPathFwd + "'" + ').MongoClient;' +
      'MC.connect(' + "'" + $MongoUri + "'" + ',{serverSelectionTimeoutMS:3000})' +
      '.then(function(c){c.close();process.exit(0)})' +
      '.catch(function(){process.exit(1)});'
    [System.IO.File]::WriteAllText($tmpJs, $jsContent)
    node $tmpJs 2>$null
    Remove-Item $tmpJs -Force -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -eq 0) { Write-Host "      Connected successfully." -ForegroundColor Green }
    else { Write-Host "      WARNING: Could not connect. Check your .env." -ForegroundColor Yellow }
  }
} else {
  Write-Host "`n[2-4/7] SQLite backend — writing .env (no MongoDB needed)..." -ForegroundColor Yellow
  $EnvContent = @"
DAKO_STORAGE_BACKEND=sqlite
DAKO_SQLITE_PATH=.dako/memory.db
DAKO_AGENT=opencode
"@
  Write-Utf8NoBom $EnvPath $EnvContent
  Write-Host "      .env written to $EnvPath" -ForegroundColor Green
}

# ── 5. opencode.json (MCP registrations) ─────────────────────────────────────
Write-Host "`n[5/7] Writing opencode.json..." -ForegroundColor Yellow
$ServerPath = "$HarnessFwd/mcps/mongodb-memory/server.js"
$StmBin     = "$HarnessFwd/bin/dako-stm.exe"
$OpencodeJson = Join-Path $ProjectPath "opencode.json"
if (Test-Path $OpencodeJson) {
  Write-Host "      opencode.json already exists — ensure it contains these mcp entries:" -ForegroundColor Yellow
  Write-Host "        dako-long-term-memory  -> node $ServerPath" -ForegroundColor Yellow
  Write-Host "        dako-short-term-memory -> $StmBin (env DAKO_PROJECT_ROOT=$ProjectFwd)" -ForegroundColor Yellow
} else {
  $OcContent = @"
{
  "`$schema": "https://opencode.ai/config.json",
  "mcp": {
    "dako-long-term-memory": {
      "type": "local",
      "command": ["node", "$ServerPath"],
      "enabled": true,
      "environment": { "DAKO_AGENT": "opencode" }
    },
    "dako-short-term-memory": {
      "type": "local",
      "command": ["$StmBin"],
      "enabled": true,
      "environment": { "DAKO_PROJECT_ROOT": "$ProjectFwd" }
    }
  },
  "instructions": ["AGENTS.md"]
}
"@
  Write-Utf8NoBom $OpencodeJson $OcContent
  Write-Host "      opencode.json written." -ForegroundColor Green
}

# ── 6. Plugin + config + commands + agents ───────────────────────────────────
Write-Host "`n[6/7] Installing plugin, commands, and subagent..." -ForegroundColor Yellow
$OpencodeDir = Join-Path $ProjectPath ".opencode"
$PluginDir   = Join-Path $OpencodeDir "plugins"
New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
Copy-Item -Path (Join-Path $AdapterDir ".opencode\plugins\dako-logger.js") -Destination (Join-Path $PluginDir "dako-logger.js") -Force
Write-Host "      dako-logger.js installed." -ForegroundColor Green

$DakoCfg = @"
{
  "harnessRoot": "$HarnessFwd",
  "project": "$ProjectName",
  "agent": "opencode"
}
"@
Write-Utf8NoBom (Join-Path $OpencodeDir "dako.config.json") $DakoCfg
Write-Host "      dako.config.json written to .opencode/" -ForegroundColor Green

if ($CommandsScope -eq "global") {
  $CmdTarget = Join-Path $HOME ".config\opencode\commands"
  $AgtTarget = Join-Path $HOME ".config\opencode\agents"
} else {
  $CmdTarget = Join-Path $OpencodeDir "commands"
  $AgtTarget = Join-Path $OpencodeDir "agents"
}
New-Item -ItemType Directory -Force -Path $CmdTarget | Out-Null
New-Item -ItemType Directory -Force -Path $AgtTarget | Out-Null
Copy-Item -Path (Join-Path $AdapterDir ".opencode\commands\*") -Destination $CmdTarget -Recurse -Force
Copy-Item -Path (Join-Path $AdapterDir ".opencode\skill-registry.md") -Destination $OpencodeDir -Force
Copy-Item -Path (Join-Path $AdapterDir ".opencode\agents\*") -Destination $AgtTarget -Recurse -Force
Write-Host "      commands -> $CmdTarget" -ForegroundColor Green
Write-Host "      agents   -> $AgtTarget" -ForegroundColor Green

# ── 7. AGENTS.md memory protocol ─────────────────────────────────────────────
Write-Host "`n[7/7] Writing AGENTS.md memory protocol..." -ForegroundColor Yellow
$AgentsMdPath = Join-Path $ProjectPath "AGENTS.md"
$Block = @"

---

## DakoHarness — Memory Protocol

You have two memory systems. Use them actively.

### Session Start

Start every session blank. Do **not** preload memory. Wait for the user's first task, then decide if memory is relevant.

**After compaction:** Call ``find_patterns`` with query ``context-snapshot`` for this project to recover where work was interrupted.

### During a Session — When to Search

- Call ``find_patterns`` with task keywords if the task feels like something done recently
- Call ``recall`` with keywords if you need a past decision or convention
- Do not search memory for tasks clearly unrelated to past work

### During a Session — When to Save

**Short-term** (``remember_pattern``): user accepts an approach, bug fixed with reusable pattern, convention established.
**Long-term** (``remember``): architectural decision, permanent convention, systemic bug lesson, important project fact.

Session transcripts are captured automatically by the dako-logger plugin — you do not need to log messages manually.

### Workitem phase chaining

OpenCode cannot invoke ``/wi-<phase>`` as a slash command on your behalf. When a workitem command says "chain into ``/wi-<phase>``" (e.g. ``/wi-next`` advancing review → document), read that phase's command file ``.opencode/commands/wi-<phase>.md`` and execute its steps in the same turn. Never just advance the phase pointer and stop — that silently drops Document / Repo / Archive.
"@
if (Test-Path $AgentsMdPath) {
  $existing = Get-Content $AgentsMdPath -Raw
  if ($existing -match "DakoHarness — Memory Protocol") {
    Write-Host "      AGENTS.md already contains the block — skipping." -ForegroundColor Green
  } else {
    Append-Utf8NoBom $AgentsMdPath $Block
    Write-Host "      Appended to existing AGENTS.md" -ForegroundColor Green
  }
} else {
  Write-Utf8NoBom $AgentsMdPath $Block.TrimStart()
  Write-Host "      Created AGENTS.md" -ForegroundColor Green
}

Write-Host "`nSetup complete." -ForegroundColor Cyan
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  cd `"$ProjectPath`"" -ForegroundColor Cyan
Write-Host "  opencode" -ForegroundColor Cyan
Write-Host "  then run  /doctor  (full health check) and  /recall test  (verify MCPs)." -ForegroundColor Cyan
