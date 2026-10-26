# 先停守护，再停桥接，避免守护马上把桥接拉起来。
param()
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue

$watchdogs = $procs | Where-Object { $_.CommandLine -match 'watchdog\.cjs' }
foreach ($p in $watchdogs) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "已停止 watchdog (PID $($p.ProcessId))"
}

Start-Sleep -Seconds 2

$bridges = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'bridge\.cjs' }
foreach ($p in $bridges) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "已停止 bridge (PID $($p.ProcessId))"
}

if (-not $watchdogs -and -not $bridges) { Write-Host "本来就没在运行" }
