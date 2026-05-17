@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "C:\Users\Lokesh Thanala\Desktop\xbuddy-print-agent"

echo Starting Cloudflare Tunnel...
start "Cloudflare Tunnel" cloudflared.exe tunnel --url http://localhost:3001

echo Waiting for tunnel to start...
timeout /t 5 /nobreak

echo Starting X Buddy Print Agent...
node index.js
pause
