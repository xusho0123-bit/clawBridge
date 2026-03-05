@echo off
chcp 65001 >nul
title ClawBridge 重啟

echo.
echo === ClawBridge 重啟 ===
echo.

:: 1. 殺掉所有舊的 Bridge
echo [1] 關閉舊 Bridge...
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq node.exe" /fo list ^| findstr "PID"') do (
    wmic process where "processid=%%i" get commandline 2>nul | findstr "bridge.js" >nul && (
        taskkill /pid %%i /f >nul 2>&1
        echo     已關閉 PID: %%i
    )
)
timeout /t 2 /nobreak >nul

:: 2. 清除舊連線資料
echo [2] 清除舊連線資料...
if exist "data\session.json" (
    echo {}> data\session.json
    echo     session.json 已清除
)

:: 3. 啟動新 Bridge
echo.
echo [3] 啟動 Bridge...
echo.
node bridge.js

echo.
echo Bridge 已停止。按任意鍵關閉...
pause
