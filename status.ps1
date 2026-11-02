$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $root "config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$port = if ($config.service.healthPort) { [int]$config.service.healthPort } else { 8799 }
try { Invoke-RestMethod -Uri ("http://127.0.0.1:" + $port + "/health") -TimeoutSec 5 | Select-Object role,pid,authenticated,uptimeSeconds,busy,connectionStale | Format-List }
catch { Write-Output "This service is not responding on its configured local health port."; exit 1 }
