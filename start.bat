@echo off
chcp 65001 >nul
title ClawBridge

echo.
echo   ClawBridge 啟動中...
echo.

if not exist ".env" (
    echo [錯誤] 找不到 .env！
    echo 請先執行 pc-update.bat
    pause
    exit /b 1
)

node bridge.js

echo.
echo Bridge 已停止。按任意鍵關閉...
pause
