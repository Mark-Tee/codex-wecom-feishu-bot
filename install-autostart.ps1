# User logon task; no passwords or system-account browser profiles.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $root "config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$taskName = if ($config.service.taskName) { [string]$config.service.taskName } else { "CodexWeComBridge" }
if ($taskName -notmatch "^[A-Za-z0-9_-]{1,64}$") { throw "Invalid task name" }
$launcher = Join-Path $root "launch-hidden.vbs"
$pwsh = Join-Path $env:SystemRoot "System32\wscript.exe"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $pwsh -Argument ('//B //Nologo "' + $launcher + '"') -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$recovery = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($trigger, $recovery) -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Write-Output "Installed user logon task; scheduler retries guardian failures every minute."
} catch {
    Write-Warning "Task registration unavailable; using the Windows user Startup shortcut. Guardian still restarts the bot."
    & (Join-Path $root "install-startup.ps1")
}
