@echo off
setlocal enabledelayedexpansion

REM Change to the directory of this script
cd /d %~dp0

echo 🔧 Ensuring dependencies are installed...
call npm install --silent --no-audit --no-fund

if not exist .env (
  echo ⚠️  No .env file found. Creating one from .env.example if available.
  if exist .env.example (
    copy /Y .env.example .env >NUL
  ) else (
    ( 
      echo PEXELS_API_KEYS=
      echo QUERY=
      echo PER_PAGE=80
      echo START_PAGE=1
      echo FETCH_INTERVAL_MINUTES=60
      echo COOLDOWN_HOURS=1
    ) > .env
  )
  echo ➡️  Please edit .env to add your Pexels API keys before continuing.
)

echo 🚀 Starting downloader... (Press Ctrl+C to stop)
node index.js

REM Keep the window open if the process exits immediately
if errorlevel 1 (
  echo.
  echo 💥 The process exited with an error. Review the logs above.
  pause
)

endlocal
