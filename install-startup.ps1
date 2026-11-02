$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "CodexWeComBridge.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $root "start-hidden.ps1") + '"'
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7
$shortcut.Description = "User logon launcher for the local bot guardian"
$shortcut.Save()
if (-not (Test-Path -LiteralPath $shortcutPath)) { throw "Startup registration failed" }
& (Join-Path $root "start-hidden.ps1")
Write-Output "Installed Windows user logon shortcut; scripts and logs remain in the project."
