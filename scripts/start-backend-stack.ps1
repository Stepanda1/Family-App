$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
  docker info *> $null
  if ($LASTEXITCODE -eq 0) {
    break
  }

  Start-Sleep -Seconds 5
}

docker compose up -d --build postgres api worker cron
