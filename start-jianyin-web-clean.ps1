$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BundledNode = "C:\Users\r\Documents\Codex\2026-06-22\ba\work\tools\node-current\node.exe"
$NodeExe = if (Test-Path $BundledNode) { $BundledNode } else { "node" }
$Port = 5188
$Url = "http://127.0.0.1:$Port/"
$LogDir = Join-Path $ProjectDir "logs"
$LogFile = Join-Path $LogDir "jianyin-web-clean-server.log"
$ErrorLogFile = Join-Path $LogDir "jianyin-web-clean-server-error.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
    Start-Process -FilePath $NodeExe `
        -ArgumentList @("server.mjs", "--port", "$Port") `
        -WorkingDirectory $ProjectDir `
        -RedirectStandardOutput $LogFile `
        -RedirectStandardError $ErrorLogFile `
        -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 300
        $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    } while (-not $listener -and (Get-Date) -lt $deadline)
}

Start-Process $Url
