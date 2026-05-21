#!/usr/bin/env pwsh
# DakoHarness setup script for Windows (PowerShell)
# Usage: .\setup.ps1 [-ProjectPath <path>]
param(
  [string]$ProjectPath = $PWD
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "`nDakoHarness Setup" -ForegroundColor Cyan
Write-Host "=================" -ForegroundColor Cyan

# 1. Check Docker
Write-Host "`n[1/4] Checking Docker..." -ForegroundColor Yellow
try {
  docker info 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Docker not running" }
  Write-Host "      Docker is running." -ForegroundColor Green
} catch {
  Write-Error "Docker is not running. Start Docker Desktop and re-run this script."
  exit 1
}

# 2. Start MongoDB
Write-Host "`n[2/4] Starting MongoDB..." -ForegroundColor Yellow
$running = docker ps --filter "name=mcp_mongodb" --format "{{.Names}}" 2>&1
if ($running -match "mcp_mongodb") {
  Write-Host "      MongoDB container already running — skipping." -ForegroundColor Green
} else {
  docker run -d `
    --name mcp_mongodb `
    -e MONGO_INITDB_ROOT_USERNAME=dako `
    -e MONGO_INITDB_ROOT_PASSWORD=harness `
    -p 27017:27017 `
    mongo:7 | Out-Null
  Write-Host "      MongoDB started." -ForegroundColor Green
}

# 3. Create .env
Write-Host "`n[3/4] Creating .env..." -ForegroundColor Yellow
$EnvPath = Join-Path $ScriptDir "mcps\mongodb-memory\.env"
if (Test-Path $EnvPath) {
  Write-Host "      .env already exists — skipping." -ForegroundColor Green
} else {
  $EnvContent = @"
MONGO_USER=dako
MONGO_PASSWORD=harness
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=agent_memory
MONGO_URI=mongodb://dako:harness@localhost:27017/agent_memory?authSource=admin

DAKO_AGENT=claude-code
"@
  Set-Content -Path $EnvPath -Value $EnvContent -Encoding utf8
  Write-Host "      .env created at $EnvPath" -ForegroundColor Green
}

# 4. Write CLAUDE.md block
Write-Host "`n[4/4] Writing CLAUDE.md memory protocol to $ProjectPath..." -ForegroundColor Yellow
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

Write-Host "`nSetup complete." -ForegroundColor Cyan
Write-Host "Next: run 'claude --plugin-dir <path-to-DakoHarness>' and then '/dako:setup' in your project." -ForegroundColor Cyan
