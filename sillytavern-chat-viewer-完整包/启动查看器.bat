@echo off
cd /d E:\github\sillytavern-chat-viewer

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

start http://localhost:5173
call npm run dev
