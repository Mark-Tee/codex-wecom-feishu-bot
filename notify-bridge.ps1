[CmdletBinding()]
param(
    [switch]$Test,
    [string]$Text
)

# 把 Codex 的 notify 事件转给本机桥接服务，由智能机器人推进最近一次会话。
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSCommandPath
$logFile = Join-Path $root "logs\notify-bridge.log"
$endpoint = "http://127.0.0.1:8799/notify"

# 存在 disabled.flag 时跳过桌面端通知（手机端任务回帖不经过这里）。
if ((-not $Test) -and (Test-Path -LiteralPath (Join-Path $root "disabled.flag"))) {
    exit 0
}

function Write-Log([string]$message) {
    try {
        if ((Test-Path -LiteralPath $logFile) -and ((Get-Item -LiteralPath $logFile).Length -gt 5MB)) {
            Move-Item -LiteralPath $logFile -Destination "$logFile.1" -Force
        }
        $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
        Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
    } catch { }
}

$stdin = [Console]::OpenStandardInput()
$reader = New-Object System.IO.StreamReader($stdin, (New-Object System.Text.UTF8Encoding($false)))
$raw = $reader.ReadToEnd()
$reader.Dispose()

function Get-Field([string]$text, [string]$name) {
    $m = [regex]::Match($text, '"?' + [regex]::Escape($name) + '"?\s*[:=]\s*"?([^",}\]]+)')
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
    return ''
}

$threadId = Get-Field $raw 'thread-id'
if (-not $threadId) { $threadId = Get-Field $raw 'session_id' }
$cwd = Get-Field $raw 'cwd'
if ($cwd -and $cwd -notmatch '\\') { $cwd = '' }

$lines = @('**Codex 任务结束**', ('时间：' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')))
if ($cwd) { $lines += ('目录：' + ($cwd -replace '\\', '/')) }
if ($threadId) { $lines += ('线程 ' + $threadId.Substring(0, [Math]::Min(8, $threadId.Length))) }
if ($Test -and $Text) { $lines += $Text }

$payload = @{ text = ($lines -join "`n") } | ConvertTo-Json -Compress
try {
    $response = Invoke-RestMethod -Uri $endpoint -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($payload)) `
        -ContentType 'application/json; charset=utf-8' -TimeoutSec 15
    Write-Log ("sent: " + ($response | ConvertTo-Json -Compress))
} catch {
    Write-Log ("failed: " + $_.Exception.Message)
}
