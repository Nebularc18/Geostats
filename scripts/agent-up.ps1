$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env"
$agentEnvPath = Join-Path $repoRoot ".env.agent.example"

if (-not (Test-Path $envPath)) {
  Copy-Item $agentEnvPath $envPath
  Write-Host "Created .env from .env.agent.example"
}

docker compose up --build
