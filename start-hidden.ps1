# 以隐藏窗口、脱离当前会话的方式启动桥接；已在运行则直接退出。
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'bridge\.cjs' }
if ($running) { exit 0 }

$candidates = @()
$candidates += Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\runtimes\cua_node" -Recurse -Filter node.exe -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) { $candidates += $nodeCmd.Source }

$node = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $node) { throw "找不到 node.exe" }

$bridge = Join-Path $root "bridge.cjs"
$cmd = "`"$node`" `"$bridge`""

# 用 WMI 创建进程：父进程是 WmiPrvSE，不会随着当前终端/会话退出而被清掉。
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine      = $cmd
    CurrentDirectory = $root
}

if ($result.ReturnValue -ne 0) {
    throw "WMI 启动失败，ReturnValue=$($result.ReturnValue)"
}
