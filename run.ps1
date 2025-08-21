Param()

$ErrorActionPreference = 'Stop'

# Move to script directory
Set-Location -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "🔧 Ensuring dependencies are installed..."
npm install --silent --no-audit --no-fund | Out-Host

if (-Not (Test-Path .env)) {
  Write-Host "⚠️  No .env file found. Creating one from .env.example if available."
  if (Test-Path .env.example) {
    Copy-Item .env.example .env -Force
  } else {
    @(
      'PEXELS_API_KEYS=',
      'QUERY=',
      'PER_PAGE=80',
      'START_PAGE=1',
      'FETCH_INTERVAL_MINUTES=60',
      'COOLDOWN_HOURS=1'
    ) | Set-Content -NoNewline:$false -Path .env -Encoding UTF8
  }
  Write-Host "➡️  Please edit .env to add your Pexels API keys before continuing."
}

Write-Host "🚀 Starting downloader... (Press Ctrl+C to stop)"
node index.js | Out-Host

