# 注册计划任务：登录时自动启动，并立即启动一次。
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$taskName = "CodexWeComBridge"
$launcher = Join-Path $root "start-hidden.ps1"
$action = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""

$created = $false
try {
    schtasks /Create /TN $taskName /TR $action /SC ONLOGON /RL LIMITED /F 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        schtasks /Run /TN $taskName 2>&1 | Out-Null
        $created = $true
    }
} catch { }

if (-not $created) {
    Write-Host "计划任务创建被拒绝，改用 WMI 直接启动（需要开机自启时用管理员再跑一次本脚本）" -ForegroundColor Yellow
    powershell -NoProfile -ExecutionPolicy Bypass -File $launcher
}

Start-Sleep -Seconds 5
$proc = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'bridge\.cjs' }

if ($proc) {
    Write-Host "已注册并启动：$taskName（PID $($proc.ProcessId)）" -ForegroundColor Green
} else {
    Write-Host "任务已注册但没有启动成功，看 logs\stderr.log" -ForegroundColor Yellow
}
