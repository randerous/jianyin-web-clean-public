@echo off
setlocal
cd /d "%~dp0"
title 既见桌面版

set "USE_LOCAL_NODE=0"
where node >nul 2>nul
if errorlevel 1 set "USE_LOCAL_NODE=1"
where npm >nul 2>nul
if errorlevel 1 set "USE_LOCAL_NODE=1"
if "%USE_LOCAL_NODE%"=="0" (
  node -e "const [M,m]=process.versions.node.split('.').map(Number);process.exit((M===20&&m>=19)||(M===22&&m>=12)||M>22?0:1)" >nul 2>nul
  if errorlevel 1 set "USE_LOCAL_NODE=1"
)

if "%USE_LOCAL_NODE%"=="1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap-node-windows.ps1"
  if errorlevel 1 goto :failed
  set "PATH=%~dp0.runtime\node;%PATH%"
)

node "%~dp0scripts\start-desktop.mjs"
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo 启动失败。请保留此窗口中的错误信息。
pause
exit /b 1
