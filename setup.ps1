#!/usr/bin/env pwsh
# DakoHarness setup script for Windows (PowerShell)
# Usage: .\setup.ps1 [-ProjectPath <path>]
param(
  [string]$ProjectPath = $PWD
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvPath = Join-Path $ScriptDir "mcps\mongodb-memory\.env"

Write-Host "`nDakoHarness Setup" -ForegroundColor Cyan
Write-Host "=================" -ForegroundColor Cyan

# 1. MongoDB — detect native or Docker
Write-Host "`n[1/5] MongoDB..." -ForegroundColor Yellow
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
    Write-Host "ERROR: MongoDB is not running on port 27017. Install Docker or start MongoDB first." -ForegroundColor Red
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

# 2. Credentials — prompt with defaults from existing .env or hardcoded fallback
Write-Host "`n[2/5] Credentials..." -ForegroundColor Yellow
$DefaultUser = "dako"
$DefaultPass = "harness"

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

DAKO_AGENT=claude-code
"@
Set-Content -Path $EnvPath -Value $EnvContent -Encoding utf8
Write-Host "      .env written to $EnvPath" -ForegroundColor Green

# 3. Test connection
Write-Host "`n[3/5] Testing connection..." -ForegroundColor Yellow
$NmPath = Join-Path $ScriptDir "mcps\mongodb-memory\node_modules\mongodb"
if (-not (Test-Path $NmPath)) {
  Write-Host "      Skipping — run 'npm install --prefix mcps/mongodb-memory' first." -ForegroundColor Yellow
} else {
  $NmPathFwd = (Join-Path $ScriptDir "mcps/mongodb-memory/node_modules/mongodb") -replace '\\', '/'
  $tmpJs = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.js'
  $jsContent = 'var MC=require(' + "'" + $NmPathFwd + "'" + ').MongoClient;' +
    'MC.connect(' + "'" + $MongoUri + "'" + ',{serverSelectionTimeoutMS:3000})' +
    '.then(function(c){c.close();process.exit(0)})' +
    '.catch(function(){process.exit(1)});'
  [System.IO.File]::WriteAllText($tmpJs, $jsContent)
  node $tmpJs 2>$null
  Remove-Item $tmpJs -Force -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -eq 0) {
    Write-Host "      Connected successfully." -ForegroundColor Green
  } else {
    Write-Host "      WARNING: Could not connect with provided credentials. Check your .env." -ForegroundColor Yellow
  }
}

# 4. Write CLAUDE.md block
Write-Host "`n[4/5] Writing CLAUDE.md memory protocol to $ProjectPath..." -ForegroundColor Yellow
$ClaudeMdPath = Join-Path $ProjectPath "CLAUDE.md"
$Block = @"

---

## DakoHarness — Memory Protocol

You have two memory systems. Use them actively.

### Session Start

Start every session blank. Do **not** preload memory. Wait for the user's first task, then decide if memory is relevant.

**After compaction:** Call ``get_context`` once to check for compaction snapshots (tag ``auto-cleanup``). If found, read to understand where work was interrupted, then delete with ``forget``.

### During a Session — When to Search

- Call ``find_patterns`` with task keywords if the task feels like something done recently
- Call ``recall`` with keywords if you need a past decision or convention
- Do not search memory for tasks clearly unrelated to past work

### During a Session — When to Save

**Short-term** (``remember_pattern``): user accepts an approach, bug fixed with reusable pattern, convention established.
**Long-term** (``remember``): architectural decision, permanent convention, systemic bug lesson, important project fact.

### Tool Reference

| Situation | Tool |
|---|---|
| After compaction — check snapshot | ``get_context`` |
| User accepts an approach | ``remember_pattern`` |
| Architectural decision | ``remember`` type: decision |
| Convention established | ``remember`` type: convention |
| Bug fixed | ``remember`` type: bug |
| Before similar task | ``find_patterns`` |
| Searching past decisions | ``recall`` |
"@

if (Test-Path $ClaudeMdPath) {
  Add-Content -Path $ClaudeMdPath -Value $Block -Encoding utf8
  Write-Host "      Appended to existing CLAUDE.md" -ForegroundColor Green
} else {
  Set-Content -Path $ClaudeMdPath -Value $Block.TrimStart() -Encoding utf8
  Write-Host "      Created CLAUDE.md" -ForegroundColor Green
}

# 5. Write hooks and MCP config
Write-Host "`n[5/5] Configuring hooks and MCP servers..." -ForegroundColor Yellow
$SettingsDir = Join-Path $ProjectPath ".claude"
$SettingsFile = Join-Path $SettingsDir "settings.json"
New-Item -ItemType Directory -Force -Path $SettingsDir | Out-Null

$LoggerPath = (Join-Path $ScriptDir "mcps\mongodb-memory\logger.mjs") -replace '\\', '/'
$StmBin     = (Join-Path $ScriptDir "bin\dako-stm.exe") -replace '\\', '/'
$ServerPath = (Join-Path $ScriptDir "mcps\mongodb-memory\server.js") -replace '\\', '/'
$ProjectFwd = ($ProjectPath.ToString()) -replace '\\', '/'

if (Test-Path $SettingsFile) {
  Write-Host "      .claude/settings.json already exists — add hooks manually:" -ForegroundColor Yellow
  Write-Host "      `"node $LoggerPath <event>`"" -ForegroundColor Yellow
} else {
  $SettingsContent = @"
{
  "hooks": {
    "UserPromptSubmit": [{"matcher": "", "hooks": [{"type": "command", "command": "node $LoggerPath UserPromptSubmit"}]}],
    "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "node $LoggerPath Stop"}]}],
    "PreCompact": [{"matcher": "", "hooks": [{"type": "command", "command": "node $LoggerPath PreCompact"}]}],
    "SessionStart": []
  }
}
"@
  Set-Content -Path $SettingsFile -Value $SettingsContent -Encoding utf8
  Write-Host "      .claude/settings.json written." -ForegroundColor Green
}

$McpContent = @"
{
  "mcpServers": {
    "dako-long-term-memory": {
      "command": "node",
      "args": ["$ServerPath"]
    },
    "dako-short-term-memory": {
      "command": "$StmBin",
      "env": {
        "DAKO_PROJECT_ROOT": "$ProjectFwd"
      }
    }
  }
}
"@
Set-Content -Path (Join-Path $ProjectPath ".mcp.json") -Value $McpContent -Encoding utf8
Write-Host "      .mcp.json written." -ForegroundColor Green

Write-Host "`nSetup complete." -ForegroundColor Cyan
Write-Host "Next: run 'claude --plugin-dir `"$ScriptDir`"' in your project directory." -ForegroundColor Cyan
