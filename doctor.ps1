[CmdletBinding()]
param([switch]$Full)

# 一键体检：把已知的集成接缝全测一遍，输出 ok / warn / fail。
$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
$script:fail = 0
$script:warn = 0

function Report([string]$state, [string]$name, [string]$detail = "") {
    switch ($state) {
        "ok"   { Write-Host ("[ok]   " + $name + $(if ($detail) { "  — " + $detail } else { "" })) -ForegroundColor Green }
        "warn" { $script:warn++; Write-Host ("[warn] " + $name + $(if ($detail) { "  — " + $detail } else { "" })) -ForegroundColor Yellow }
        "fail" { $script:fail++; Write-Host ("[fail] " + $name + $(if ($detail) { "  — " + $detail } else { "" })) -ForegroundColor Red }
    }
}

# 1. 配置
$cfgPath = Join-Path $root "config.json"
$cfg = $null
if (-not (Test-Path -LiteralPath $cfgPath)) {
    Report "fail" "config.json 存在" "缺少配置文件"
} else {
    try {
        $cfg = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $bad = @()
        if (-not $cfg.botId) { $bad += "botId" }
        if (-not $cfg.secret) { $bad += "secret" }
        if ($bad.Count) { Report "fail" "config.json 凭证" ("缺少: " + ($bad -join ", ")) }
        else { Report "ok" "config.json 凭证" "已填写" }
    } catch {
        Report "fail" "config.json 解析" $_.Exception.Message
    }
}

# 2. 工作目录
if ($cfg -and $cfg.workdir) {
    if (Test-Path -LiteralPath $cfg.workdir) { Report "ok" "工作目录" $cfg.workdir }
    else { Report "fail" "工作目录" ("不存在: " + $cfg.workdir) }
}

# 2b. 飞书/腾讯文档 worker
if ($cfg -and $cfg.dutyAgent -and $cfg.dutyAgent.enabled) {
    $agent = $cfg.dutyAgent
    $agentRoot = if ([IO.Path]::IsPathRooted($agent.repoPath)) { $agent.repoPath } else { Join-Path $root $agent.repoPath }
    $agentConfig = if ([IO.Path]::IsPathRooted($agent.configPath)) { $agent.configPath } else { Join-Path $root $agent.configPath }
    $agentScript = if ([IO.Path]::IsPathRooted($agent.scriptPath)) { $agent.scriptPath } else { Join-Path $root $agent.scriptPath }
    foreach ($item in @(
        @{ Name = "值班 worker"; Path = $agentRoot },
        @{ Name = "worker 配置"; Path = $agentConfig },
        @{ Name = "worker 入口"; Path = $agentScript }
    )) {
        if (Test-Path -LiteralPath $item.Path) { Report "ok" $item.Name $item.Path }
        else { Report "fail" $item.Name ("不存在: " + $item.Path) }
    }
    if (Test-Path -LiteralPath $agentConfig) {
        try {
            $workerCfg = Get-Content -LiteralPath $agentConfig -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($workerCfg.feishuBrowser.enabled) {
                $requiredFieldIds = @("taskList", "source", "location", "transactionNo", "roomTicketNo", "workContent", "specificWork", "expectedEnterAt", "assignees", "companions")
                $missingFieldIds = @($requiredFieldIds | Where-Object {
                    -not $workerCfg.feishuBrowser.fieldIds.$_ -or
                    $workerCfg.feishuBrowser.fieldIds.$_ -notmatch '^fld[A-Za-z0-9]+$'
                })
                if (-not $workerCfg.feishuBrowser.formUrl -or $workerCfg.feishuBrowser.formUrl -match 'YOUR_') {
                    Report "fail" "飞书浏览器配置" "formUrl 为空或仍有占位符"
                } elseif ($missingFieldIds.Count -and $workerCfg.feishuBrowser.autoDiscoverFields -eq $true) {
                    Report "warn" "飞书字段自动发现" ("缺少 " + ($missingFieldIds -join ", ") + "，首次填表会尝试发现")
                } elseif ($missingFieldIds.Count) {
                    Report "fail" "飞书字段映射" ("缺少 " + ($missingFieldIds -join ", "))
                } elseif ($workerCfg.feishuBrowser.entryMode -eq "record" -and -not $workerCfg.feishuBrowser.taskListViewId) {
                    Report "warn" "飞书全部任务视图" "未配置，首次填表会尝试自动发现"
                } else {
                    Report "ok" "飞书浏览器配置" "已启用"
                }
            } else {
                Report "warn" "飞书浏览器配置" "未启用"
            }
        } catch {
            Report "fail" "worker 配置解析" $_.Exception.Message
        }
    }
    $token = if ($env:TENCENT_DOCS_TOKEN) { $env:TENCENT_DOCS_TOKEN } else { [Environment]::GetEnvironmentVariable("TENCENT_DOCS_TOKEN", "User") }
    if ([string]::IsNullOrWhiteSpace($token)) { Report "warn" "腾讯文档 Token" "未设置，/done 不可用" }
    else { Report "ok" "腾讯文档 Token" "已设置（未显示）" }
}

# 3. node
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (Test-Path -LiteralPath $nodePath) { Report "ok" "node 可执行文件" $nodePath }
else {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { Report "ok" "node 可执行文件" $cmd.Source } else { Report "fail" "node 可执行文件" "找不到" }
}

# 4. codex 可执行文件（后台启动时 PATH 里没有，必须能自己解析）
$codexCandidates = Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin" -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName "codex.exe" } |
    Where-Object { Test-Path -LiteralPath $_ }
if ($codexCandidates) { Report "ok" "codex 可执行文件" (($codexCandidates | Select-Object -First 1)) }
else { Report "fail" "codex 可执行文件" "LOCALAPPDATA\OpenAI\Codex\bin 下没找到" }

# 5. 守护与桥接进程
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
$wd = $procs | Where-Object { $_.CommandLine -match 'watchdog\.cjs' }
$br = $procs | Where-Object { $_.CommandLine -match 'bridge\.cjs' }
if ($wd) { Report "ok" "watchdog 进程" ("PID " + $wd.ProcessId) } else { Report "warn" "watchdog 进程" "未运行，退出后不会自动重启" }
if ($br) { Report "ok" "bridge 进程" ("PID " + $br.ProcessId) } else { Report "fail" "bridge 进程" "未运行" }

# 6. 长连接认证
$log = Join-Path $root "logs\bridge.log"
if (Test-Path -LiteralPath $log) {
    $tail = Get-Content -LiteralPath $log -Tail 40 -Encoding UTF8
    $authIndex = -1
    for ($i = 0; $i -lt $tail.Count; $i++) { if ($tail[$i] -match 'authenticated as') { $authIndex = $i } }
    if ($authIndex -lt 0) { Report "fail" "长连接认证" "日志里没有 authenticated" }
    else {
        $after = $tail[($authIndex + 1)..($tail.Count - 1)] | Where-Object { $_ }
        $bad = $after | Where-Object { $_ -match 'auth failed|ws closed' }
        if ($bad) { Report "warn" "长连接认证" ("最后一次认证之后有异常: " + $bad[-1]) }
        else { Report "ok" "长连接认证" $tail[$authIndex] }
    }
    $size = (Get-Item -LiteralPath $log).Length / 1MB
    if ($size -gt 5) { Report "warn" "日志大小" ("{0:N1} MB，超过轮转阈值" -f $size) }
    else { Report "ok" "日志大小" ("{0:N2} MB" -f $size) }
} else { Report "warn" "bridge.log" "还没有日志" }

# 7. 通知端口
$listen = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 8799 }
if ($listen) { Report "ok" "通知端口 8799" "监听中" } else { Report "warn" "通知端口 8799" "未监听（桌面端任务通知不可用）" }

# 8. 登录自启
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "CodexWeComBridge.lnk"
if (Test-Path -LiteralPath $lnk) { Report "ok" "登录自启" "已启用" } else { Report "warn" "登录自启" "未启用" }

# 9. 桌面端推送开关
if (Test-Path -LiteralPath (Join-Path $root "disabled.flag")) { Report "ok" "桌面端通知" "已禁用（disabled.flag）" }
else { Report "ok" "桌面端通知" "启用中" }

# 10. 可选：真的跑一次沙箱写测试
if ($Full -and $cfg -and $cfg.workdir) {
    Write-Host "运行完整写权限测试（约 20 秒）..." -ForegroundColor Cyan
    $node = if (Test-Path -LiteralPath $nodePath) { $nodePath } else { "node" }
    $probe = ".doctor-write-test.tmp"
    $target = Join-Path $cfg.workdir $probe
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
    & $node (Join-Path $root "bridge.cjs") --ask ("在当前工作目录创建文件 " + $probe + " 写入 ok") | Out-Null
    if (Test-Path -LiteralPath $target) {
        Report "ok" "沙箱写权限" "能写入工作目录"
        Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
    } else {
        Report "fail" "沙箱写权限" "写入失败，检查 sandbox_mode"
    }
}

if ($Full -and $cfg -and $cfg.dutyReport -and $cfg.dutyReport.enabled) {
    Write-Host "运行腾讯文档在线源只读检查..." -ForegroundColor Cyan
    $node = if (Test-Path -LiteralPath $nodePath) { $nodePath } else { "node" }
    $reader = Join-Path $cfg.dutyReport.repoPath "scripts\online_sheet.mjs"
    $token = [Environment]::GetEnvironmentVariable("TENCENT_DOCS_TOKEN", "User")
    $env:TENCENT_DOCS_TOKEN = $token
    try {
        & $node $reader --config $cfg.dutyReport.configPath --kind schedule --list-sheets | Out-Null
        if ($LASTEXITCODE -eq 0) { Report "ok" "腾讯文档在线源" "排班文档只读成功" }
        else { Report "fail" "腾讯文档在线源" "排班文档读取失败" }
    } catch {
        Report "fail" "腾讯文档在线源" $_.Exception.Message
    } finally {
        Remove-Item Env:TENCENT_DOCS_TOKEN -ErrorAction SilentlyContinue
        Remove-Variable token -ErrorAction SilentlyContinue
    }
}

Write-Host ""
if ($script:fail -gt 0) {
    Write-Host ("体检结果：$($script:fail) 项失败，$($script:warn) 项警告") -ForegroundColor Red
    exit 1
} elseif ($script:warn -gt 0) {
    Write-Host ("体检结果：通过，$($script:warn) 项警告") -ForegroundColor Yellow
} else {
    Write-Host "体检结果：全部通过" -ForegroundColor Green
}
