$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$found = Get-Command node -ErrorAction SilentlyContinue
if (-not $found) {
    Write-Host "找不到 node，无法启动。请先安装 Node.js 22+。" -ForegroundColor Yellow
    exit 1
}
$nodeExe = $found.Source

& $nodeExe .\bridge.cjs
