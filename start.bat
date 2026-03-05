@echo off
chcp 65001 >nul
title ClawBridge

echo.
echo === ClawBridge 啟動 ===
echo.

:: 0. 殺掉舊的 Bridge
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq node.exe" /fo list ^| findstr "PID"') do (
    wmic process where "processid=%%i" get commandline 2>nul | findstr "bridge.js" >nul && (
        taskkill /pid %%i /f >nul 2>&1
        echo [OK] 已關閉舊 Bridge PID: %%i
    )
)
timeout /t 2 /nobreak >nul

:: 0.5 清除舊連線
if exist "data\session.json" (
    echo {}> data\session.json
    echo [OK] 舊連線已清除
)

if not exist ".env" (
    echo [錯誤] 找不到 .env！
    echo 請先執行 pc-update.bat
    pause
    exit /b 1
)

echo.
node bridge.js

echo.
echo Bridge 已停止。按任意鍵關閉...
pause
