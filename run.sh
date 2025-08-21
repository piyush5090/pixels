#!/usr/bin/env bash
set -euo pipefail

# Move to script directory
cd "$(dirname "$0")"

echo "🔧 Ensuring dependencies are installed..."
npm install --silent --no-audit --no-fund | cat

if [ ! -f .env ]; then
  echo "⚠️  No .env file found. Creating one from .env.example."
  if [ -f .env.example ]; then
    cp .env.example .env
  else
    cat > .env <<'EOF'
PEXELS_API_KEYS=
QUERY=
PER_PAGE=80
START_PAGE=1
FETCH_INTERVAL_MINUTES=60
COOLDOWN_HOURS=1
EOF
  fi
  echo "➡️  Please edit .env to add your Pexels API keys before continuing."
fi

echo "🚀 Starting downloader... (Press Ctrl+C to stop)"
node index.js | cat

