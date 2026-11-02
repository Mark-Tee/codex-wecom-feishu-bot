# Stop only this checkout; prevent the task scheduler from relaunching the guardian.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $root "config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$taskName = if ($config.service.taskName) { [string]$config.service.taskName } else { "CodexWeComBridge" }
if ($taskName -notmatch "^[A-Za-z0-9_-]{1,64}$") { throw "Invalid task name" }
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task -and ($task.Actions.Arguments -like ('*' + $root + '*'))) {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    Stop-ScheduledTask -TaskName $taskName
}
foreach ($entry in @("watchdog.cjs", "bridge.cjs", "roster-bot.cjs")) {
    $target = Join-Path $root $entry
    $processes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($target) }
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Output ("Stopped " + $entry + " PID " + $process.ProcessId)
    }
}
