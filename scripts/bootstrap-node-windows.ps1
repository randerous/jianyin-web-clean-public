$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RuntimeDir = Join-Path $ProjectDir ".runtime\node"
$RuntimeNode = Join-Path $RuntimeDir "node.exe"
if (Test-Path $RuntimeNode) { exit 0 }

Write-Host "Compatible Node.js was not found. Downloading official Node 22 LTS into this project..."
$releases = Invoke-RestMethod "https://nodejs.org/dist/index.json"
$release = $releases | Where-Object { $_.version -like "v22.*" -and $_.lts } | Select-Object -First 1
if (-not $release) { throw "Node 22 LTS was not found in the official Node.js release index" }

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -and $release.files -contains "win-arm64-zip") { "arm64" } else { "x64" }
$archiveName = "node-$($release.version)-win-$arch.zip"
$baseUrl = "https://nodejs.org/dist/$($release.version)"
$TempDir = Join-Path ([IO.Path]::GetTempPath()) "jianyin-node-$([Guid]::NewGuid().ToString('N'))"
$ArchivePath = Join-Path $TempDir $archiveName
$ChecksumsPath = Join-Path $TempDir "SHASUMS256.txt"

New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
try {
    Invoke-WebRequest "$baseUrl/$archiveName" -OutFile $ArchivePath
    Invoke-WebRequest "$baseUrl/SHASUMS256.txt" -OutFile $ChecksumsPath
    $checksumLine = Get-Content $ChecksumsPath | Where-Object { $_ -match "\s$([Regex]::Escape($archiveName))$" } | Select-Object -First 1
    if (-not $checksumLine) { throw "$archiveName was not found in the official checksum file" }
    $expected = ($checksumLine -split "\s+")[0].ToLowerInvariant()
    $actual = (Get-FileHash $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Node.js download SHA-256 verification failed" }

    Expand-Archive $ArchivePath -DestinationPath $TempDir
    $ExtractedDir = Join-Path $TempDir "node-$($release.version)-win-$arch"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $RuntimeDir) | Out-Null
    if (Test-Path $RuntimeDir) { Remove-Item $RuntimeDir -Recurse -Force }
    Move-Item $ExtractedDir $RuntimeDir
    Write-Host "Node.js $($release.version) is ready."
} finally {
    Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
