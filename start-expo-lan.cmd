@echo off
cd /d "%~dp0"
set EXPO_NO_DEPENDENCY_VALIDATION=1
cd /d "%~dp0apps\mobile"
npx expo start --host lan --port 8082 >> expo-lan-runtime.log 2>&1
