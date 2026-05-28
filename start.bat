@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "C:\Users\Lokesh Thanala\Desktop\xbuddy-print-agent"

echo Starting Cloudflare Tunnel...
if exist tunnel.log del tunnel.log

start "Cloudflare Tunnel" cmd /c "cloudflared.exe tunnel --url http://localhost:3001 > tunnel.log 2>&1"

echo Waiting for tunnel URL...
timeout /t 8 /nobreak > nul

echo Starting X Buddy Print Agent...
node index.js
pause
