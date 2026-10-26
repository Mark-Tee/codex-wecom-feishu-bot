# 一眼看清桥接状态：进程、认证情况、最近日志。
$root = $PSScriptRoot
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'watchdog\.cjs|bridge\.cjs' }

if (-not $procs) {
    Write-Host "桥接没有在运行" -ForegroundColor Red
    Write-Host "启动：powershell -ExecutionPolicy Bypass -File `"$root\install-startup.ps1`""
    exit 1
}

$procs | ForEach-Object {
    $kind = if ($_.CommandLine -match 'watchdog') { "watchdog" } else { "bridge" }
    [pscustomobject]@{ Kind = $kind; PID = $_.ProcessId; StartedAt = $_.CreationDate }
} | Format-Table -AutoSize

$log = Join-Path $root "logs\bridge.log"
if (Test-Path -LiteralPath $log) {
    Write-Host "最近日志：" -ForegroundColor Cyan
    Get-Content -LiteralPath $log -Tail 5
}

$startup = Join-Path ([Environment]::GetFolderPath("Startup")) "CodexWeComBridge.lnk"
Write-Host ("登录自启：" + $(if (Test-Path -LiteralPath $startup) { "已启用" } else { "未启用" }))
