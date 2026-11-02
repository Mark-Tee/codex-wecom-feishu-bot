# Stop only this checkout; prevent the task scheduler from relaunching the guardian.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$task = Get-ScheduledTask -TaskName "CodexWeComBridge" -ErrorAction SilentlyContinue
if ($task -and ($task.Actions.Arguments -like ('*' + $root + '*'))) {
    Disable-ScheduledTask -TaskName "CodexWeComBridge" | Out-Null
    Stop-ScheduledTask -TaskName "CodexWeComBridge"
}
foreach ($entry in @("watchdog.cjs", "bridge.cjs")) {
    $target = Join-Path $root $entry
    $processes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($target) }
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Output ("Stopped " + $entry + " PID " + $process.ProcessId)
    }
}
