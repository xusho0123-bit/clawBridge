@echo off
chcp 65001 >nul
title ClawBridge 全部重啟

echo.
echo ============================================
echo    ClawBridge 全部重啟
echo    OpenClaw + Antigravity + Bridge
echo ============================================
echo.

:: 1. 關閉 Bridge
echo [1/5] 關閉 Bridge...
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq node.exe" /fo list ^| findstr "PID"') do (
    wmic process where "processid=%%i" get commandline 2>nul | findstr "bridge.js" >nul && (
        taskkill /pid %%i /f >nul 2>&1
        echo     已關閉 Bridge PID: %%i
    )
)

:: 2. 關閉 Antigravity
echo [2/5] 關閉 Antigravity IDE...
tasklist /fi "imagename eq Antigravity.exe" 2>nul | findstr "Antigravity" >nul && (
    taskkill /im Antigravity.exe /f >nul 2>&1
    echo     已關閉 Antigravity
) || echo     Antigravity 沒在跑

:: 3. 關閉 OpenClaw
echo [3/5] 關閉 OpenClaw...
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq node.exe" /fo list ^| findstr "PID"') do (
    wmic process where "processid=%%i" get commandline 2>nul | findstr "openclaw" >nul && (
        taskkill /pid %%i /f >nul 2>&1
        echo     已關閉 OpenClaw PID: %%i
    )
)

timeout /t 3 /nobreak >nul

:: 4. 清除舊連線
echo [4/5] 清除舊連線...
if exist "data\session.json" (
    echo {}> data\session.json
    echo     session 已清除
)

:: 5. 重新啟動
echo.
echo [5/5] 重新啟動...
echo.

:: 5a. 啟動 OpenClaw
echo     啟動 OpenClaw...
start "" /b cmd /c "openclaw-gateway >nul 2>&1"
timeout /t 2 /nobreak >nul

:: 5b. 啟動 Antigravity（從預設安裝路徑）
echo     啟動 Antigravity IDE...
if exist "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" (
    start "" "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
) else if exist "C:\Program Files\Antigravity\Antigravity.exe" (
    start "" "C:\Program Files\Antigravity\Antigravity.exe"
) else (
    echo     [警告] 找不到 Antigravity，請手動開啟
)

:: 5c. 等 Language Server
echo     等待 Language Server...
set WAIT=0
:WAIT_LOOP
if %WAIT% GEQ 60 goto WAIT_DONE
tasklist 2>nul | findstr "language_server" >nul && (
    echo     Language Server 已啟動 (%WAIT%s^)
    goto WAIT_OK
)
set /a MOD=%WAIT% %% 10
if %MOD% EQU 0 if %WAIT% GTR 0 echo     等待中... (%WAIT%s^)
timeout /t 1 /nobreak >nul
set /a WAIT+=1
goto WAIT_LOOP

:WAIT_DONE
echo     [警告] Language Server 60 秒內未偵測到
echo     Bridge 會先啟動，可用 /reconnect 重連
:WAIT_OK

:: 5d. 啟動 Bridge
echo.
echo ============================================
echo    啟動 Bridge
echo ============================================
echo.
node bridge.js

echo.
echo Bridge 已停止。按任意鍵關閉...
pause
