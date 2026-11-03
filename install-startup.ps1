$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $root "config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$taskName = if ($config.service.taskName) { [string]$config.service.taskName } else { "CodexWeComBridge" }
if ($taskName -notmatch "^[A-Za-z0-9_-]{1,64}$") { throw "Invalid task name" }
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup ($taskName + ".lnk")
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
$shortcut.Arguments = '//B //Nologo "' + (Join-Path $root "launch-hidden.vbs") + '"'
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7
$shortcut.Description = "User logon launcher for the local bot guardian"
$shortcut.Save()
if (-not (Test-Path -LiteralPath $shortcutPath)) { throw "Startup registration failed" }
& (Join-Path $root "start-hidden.ps1")
Write-Output "Installed Windows user logon shortcut; scripts and logs remain in the project."
