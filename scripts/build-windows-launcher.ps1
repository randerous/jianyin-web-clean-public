$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$BuildDir = Join-Path $Root "build\windows-launcher"
$RuntimeDir = Join-Path $BuildDir "runtime"
$RuntimeZip = Join-Path $BuildDir "runtime.zip"
$IntermediateOutput = Join-Path $Root "start-jianyin.exe"
$DesiredName = [string]::Concat([char]0x542f, [char]0x52a8, [char]0x65e2, [char]0x89c1, ".exe")
$Output = Join-Path $Root $DesiredName

if (Test-Path $BuildDir) { Remove-Item $BuildDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

Push-Location $Root
try {
    npm run build
    Copy-Item "server.mjs" $RuntimeDir
    Copy-Item "package.json" $RuntimeDir
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
        /reference:System.Runtime.Serialization.dll `
        "/resource:$RuntimeZip,JianyinRuntime" `
        "/out:$IntermediateOutput" `
        "windows\Launcher.cs"
    if ($LASTEXITCODE -ne 0) { throw "Windows launcher compilation failed" }
    if (Test-Path $Output) { Remove-Item $Output -Force }
    Move-Item $IntermediateOutput $Output
} finally {
    Pop-Location
}

Write-Host "Built $Output"
