param(
  [string]$ShortcutName = "Family App Backend Autostart.cmd"
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$launcherPath = Join-Path $startupDir $ShortcutName
$launcherContent = @"
@echo off
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
powershell -NoProfile -ExecutionPolicy Bypass -File "$projectRoot\scripts\start-backend-stack.ps1"
"@

Set-Content -LiteralPath $launcherPath -Value $launcherContent -Encoding ASCII
Write-Host "Startup launcher created at '$launcherPath'."
