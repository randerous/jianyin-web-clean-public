$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$BuildDir = Join-Path $Root "build\windows-launcher"
$RuntimeDir = Join-Path $BuildDir "runtime"
$RuntimeZip = Join-Path $BuildDir "runtime.zip"
$Output = Join-Path $Root "启动既见.exe"

if (Test-Path $BuildDir) { Remove-Item $BuildDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

Push-Location $Root
try {
    npm run build
    Copy-Item "server.mjs" $RuntimeDir
    Copy-Item "dist" $RuntimeDir -Recurse
    npm install --prefix $RuntimeDir --no-save --package-lock=false --omit=dev --no-audit --no-fund --loglevel=error `
        express@5.2.1 NeteaseCloudMusicApi@4.32.0
    Compress-Archive -Path (Join-Path $RuntimeDir "*") -DestinationPath $RuntimeZip -CompressionLevel Optimal

    $Compiler = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    if (-not (Test-Path $Compiler)) { throw "64-bit C# compiler was not found" }
    & $Compiler /nologo /target:winexe /platform:x64 /optimize+ `
        /reference:System.Windows.Forms.dll `
        /reference:System.Drawing.dll `
        /reference:System.IO.Compression.dll `
        /reference:System.IO.Compression.FileSystem.dll `
        "/resource:$RuntimeZip,JianyinRuntime" `
        "/out:$Output" `
        "windows\Launcher.cs"
    if ($LASTEXITCODE -ne 0) { throw "Windows launcher compilation failed" }
} finally {
    Pop-Location
}

Write-Host "Built $Output"
