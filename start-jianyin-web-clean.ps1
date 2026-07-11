$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $ProjectDir "start-jianyin-windows.cmd"
& $Launcher
exit $LASTEXITCODE
