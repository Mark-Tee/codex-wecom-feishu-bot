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
$taskListViewId = Read-Required "Feishu 'all tasks' view ID (vew...)"

Write-Host ""
Write-Host "Paste the JSON printed by:" -ForegroundColor Cyan
Write-Host "  node worker/src/scripts/discover-feishu-fields.mjs --config worker/config.json" -ForegroundColor Cyan
Write-Host "Leave blank to keep browser filling disabled for now."
$fieldMapRaw = Read-Host "Feishu field map JSON"

$bridge = Get-Content -LiteralPath $bridgeConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$bridge.botId = $botId
$bridge.secret = $secret
$bridge.workdir = $workdir
$bridge.dutyAgent.enabled = $true
$bridge.dutyReport.enabled = $false

$worker = Get-Content -LiteralPath $workerConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$browserWasEnabled = [bool]$worker.feishuBrowser.enabled
$worker.runtime.workdir = $workdir
$worker.duty.defaultOperator = $operator
$worker.duty.pinyinHints = @{}
$worker.feishuBrowser.formUrl = $formUrl
$worker.feishuBrowser.taskListViewId = $taskListViewId
$worker.feishuBrowser.enabled = $browserWasEnabled
$worker.feishuBrowser.autoSubmit = $true

if ($fieldMapRaw.Trim()) {
    try {
        $fieldMap = $fieldMapRaw | ConvertFrom-Json
    } catch {
        throw "Feishu field map is not valid JSON."
    }
    foreach ($key in @("taskList", "source", "location", "transactionNo", "roomTicketNo", "workContent", "specificWork", "expectedEnterAt", "assignees", "companions")) {
        if (-not $fieldMap.$key) { throw "Feishu field map is missing: $key" }
        $worker.feishuBrowser.fieldIds.$key = [string]$fieldMap.$key
    }
    $worker.feishuBrowser.enabled = $true
} else {
    if ($browserWasEnabled) {
        Write-Host "Keeping the existing Feishu field map." -ForegroundColor Green
    } else {
        Write-Host "Browser filling remains disabled until field IDs are configured." -ForegroundColor Yellow
    }
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

Write-Host "Configuration written." -ForegroundColor Green
Write-Host "Next: edit worker/duty-config.json with your sheet and draft IDs, then run doctor.cmd." -ForegroundColor Cyan
& $node.Source .\bridge.cjs --self-test
