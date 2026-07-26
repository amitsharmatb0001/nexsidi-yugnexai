@echo off
title NexSidi — Starting All Servers
echo.
echo  Starting NexSidi...
echo.

cd /d "%~dp0"

echo [1/3] API server (port 8080)...
start "NexSidi API :8080" cmd /k "cd /d "%~dp0" && bun --watch apps/api/src/index.ts"

echo [2/3] Web server (port 3000)...
start "NexSidi Web :3000" cmd /k "cd /d "%~dp0apps\web" && bun run dev"

echo [3/3] Temporal worker...
start "NexSidi Temporal Worker" cmd /k "cd /d "%~dp0" && bun pipeline/worker.ts"

echo.
echo  All servers started.
echo  API  → http://localhost:8080
echo  Web  → http://localhost:3000
echo.
pause
