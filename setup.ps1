$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js 22+ is required. Install Node.js and run setup again."
}

function Read-Required($label) {
    do {
        $value = (Read-Host $label).Trim()
        if (-not $value) { Write-Host "This value is required." -ForegroundColor Yellow }
    } while (-not $value)
    return $value
}

function Read-Secret($label) {
    $secure = Read-Host $label -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Write-Json($path, $value) {
    $json = $value | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding($false)))
}

$bridgeConfigPath = Join-Path $PSScriptRoot "config.json"
$workerDir = Join-Path $PSScriptRoot "worker"
$workerConfigPath = Join-Path $workerDir "config.json"
$dutyConfigPath = Join-Path $workerDir "duty-config.json"

if (-not (Test-Path -LiteralPath $bridgeConfigPath)) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "config.example.json") -Destination $bridgeConfigPath
}
if (-not (Test-Path -LiteralPath $workerConfigPath)) {
    Copy-Item -LiteralPath (Join-Path $workerDir "config.example.json") -Destination $workerConfigPath
}
if (-not (Test-Path -LiteralPath $dutyConfigPath)) {
    Copy-Item -LiteralPath (Join-Path $workerDir "duty-config.example.json") -Destination $dutyConfigPath
}

$botId = Read-Required "WeCom BotID"
$secret = Read-Secret "WeCom long-connection Secret"
$operator = Read-Required "Your name shown in Feishu"
$workdir = Read-Host "Codex working directory (default: $PSScriptRoot)"
if (-not $workdir) { $workdir = $PSScriptRoot }
$formUrl = Read-Required "Feishu Base record view URL"
$locationHint = "Comma-separated Feishu task location options"
$locationsRaw = Read-Host $locationHint

$bridge = Get-Content -LiteralPath $bridgeConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$bridge.botId = $botId
$bridge.secret = $secret
$bridge.workdir = $workdir
$bridge.dutyAgent.enabled = $true
$bridge.dutyReport.enabled = $false

$worker = Get-Content -LiteralPath $workerConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$worker.runtime.workdir = $workdir
$worker.duty.defaultOperator = $operator
$worker.duty.pinyinHints = @{}
$worker.feishuBrowser.formUrl = $formUrl
$worker.feishuBrowser | Add-Member -NotePropertyName autoDiscoverFields -NotePropertyValue $true -Force
$worker.feishuBrowser.enabled = $true
$worker.feishuBrowser.autoSubmit = $true
if ($locationsRaw.Trim()) {
    $worker.feishuBrowser.options.location = @(
        $locationsRaw.Split(",") |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
} elseif (-not $worker.feishuBrowser.options.location) {
    throw "At least one Feishu task location option is required."
}

$duty = Get-Content -LiteralPath $dutyConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$duty.operator_name = $operator
$duty.line.team_members = @($operator)

$tencentToken = Read-Secret "Tencent Docs token (leave blank to keep existing)"
if ($tencentToken) {
    [Environment]::SetEnvironmentVariable("TENCENT_DOCS_TOKEN", $tencentToken, "User")
    $env:TENCENT_DOCS_TOKEN = $tencentToken
}

Write-Json $bridgeConfigPath $bridge
Write-Json $workerConfigPath $worker
Write-Json $dutyConfigPath $duty

Write-Host ""
Write-Host "Opening the dedicated Feishu browser profile." -ForegroundColor Cyan
Write-Host "If Feishu asks you to sign in, complete login within 2 minutes." -ForegroundColor Yellow
$previousDiscoveryTimeout = $env:FEISHU_DISCOVERY_TIMEOUT_MS
$env:FEISHU_DISCOVERY_TIMEOUT_MS = "120000"
try {
    & $node.Source .\worker\src\scripts\discover-feishu-fields.mjs --config $workerConfigPath --write --check
    if ($LASTEXITCODE -ne 0) {
        throw "Feishu field discovery failed. See the message above, then rerun setup."
    }
} finally {
    $env:FEISHU_DISCOVERY_TIMEOUT_MS = $previousDiscoveryTimeout
}

Write-Host "Configuration written and Feishu fields discovered." -ForegroundColor Green
Write-Host "Next: run doctor.cmd. Tencent Docs can be enabled later if you use /done." -ForegroundColor Cyan
& $node.Source .\bridge.cjs --self-test
