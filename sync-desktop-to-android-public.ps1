$ErrorActionPreference = "Stop"

$ProjectDir = "C:\Users\r\Documents\Codex\2026-06-22\ba\work\jianyin-web-clean-android-ui"
$AndroidPublic = Join-Path $ProjectDir "android\app\src\main\assets\public"
$Dist = Join-Path $ProjectDir "dist"

if (-not (Test-Path $AndroidPublic)) {
    throw "Android public assets not found: $AndroidPublic"
}

if (Test-Path $Dist) {
    Remove-Item -LiteralPath $Dist -Recurse -Force
}

Copy-Item -LiteralPath $AndroidPublic -Destination $Dist -Recurse -Force
