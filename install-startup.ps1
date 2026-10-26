# 把隐藏启动脚本放进当前用户的“启动”文件夹，登录后自动运行（不需要管理员）。
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$launcher = Join-Path $root "watchdog.cjs"
$startup = [Environment]::GetFolderPath("Startup")
$lnkPath = Join-Path $startup "CodexWeComBridge.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw "找不到 node.exe，请先安装 Node.js 22+" }
$launcherExe = $nodeCmd.Source

$shortcut.TargetPath = $launcherExe
$shortcut.Arguments = "`"$launcher`""
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7
$shortcut.Description = "Codex 企业微信智能机器人桥接"
$shortcut.Save()

if (Test-Path -LiteralPath $lnkPath) {
    Write-Host "已加入登录启动：$lnkPath" -ForegroundColor Green
} else {
    Write-Host "创建启动快捷方式失败" -ForegroundColor Yellow
    exit 1
}

# 立即用 WMI 拉起守护进程（父进程 WmiPrvSE，脱离当前会话）
$cmd = "`"$launcherExe`" `"$launcher`""
$already = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'watchdog\.cjs' }
if (-not $already) {
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine      = $cmd
        CurrentDirectory = $root
    } | Out-Null
}
