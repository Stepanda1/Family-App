@echo off
cd /d "%~dp0apps\server"
npm run dev >> server-runtime.log 2>&1
