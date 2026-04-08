@echo off
cd /d "%~dp0apps\mobile"
set EXPO_NO_DEPENDENCY_VALIDATION=1
npx expo start --tunnel --port 8083 >> expo-tunnel-runtime.log 2>&1
