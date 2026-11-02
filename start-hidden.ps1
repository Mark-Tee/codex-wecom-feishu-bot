param([switch]$Wait)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" }
if (-not (Test-Path -LiteralPath $node)) { throw "Node runtime not found" }
$launcher = Join-Path $root "watchdog.cjs"
$argsList = @{FilePath=$node; ArgumentList=('"' + $launcher + '"'); WorkingDirectory=$root; WindowStyle='Hidden'; PassThru=$true}
if ($Wait) { $argsList.Wait = $true }
$process = Start-Process @argsList
if ($Wait) { exit $process.ExitCode }
