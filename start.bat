@echo off
REM Antigravity Bridge — Windows one-click start
REM 雙擊此檔案即可啟動 / Double-click to start

cd /d "%~dp0"
title Antigravity Bridge

echo === Antigravity Bridge ===
echo.

REM Kill old Bridge processes
for /f "tokens=2" %%a in ('tasklist /fi "windowtitle eq Antigravity Bridge" /fo list ^| find "PID:"') do taskkill /pid %%a /f >nul 2>&1

REM ============================================================
REM  Auto-detect Node.js if not in PATH
REM  自動偵測 Node.js 路徑
REM ============================================================
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    goto :node_found
)

echo Node.js not in PATH, searching...
echo 系統 PATH 找不到 node，正在搜尋...
echo.

REM Common Node.js install locations on Windows
set "NODE_SEARCH_PATHS="
set "NODE_SEARCH_PATHS=%NODE_SEARCH_PATHS% %ProgramFiles%\nodejs"
set "NODE_SEARCH_PATHS=%NODE_SEARCH_PATHS% %ProgramFiles(x86)%\nodejs"
set "NODE_SEARCH_PATHS=%NODE_SEARCH_PATHS% %LOCALAPPDATA%\Programs\nodejs"
set "NODE_SEARCH_PATHS=%NODE_SEARCH_PATHS% %APPDATA%\npm"
set "NODE_SEARCH_PATHS=%NODE_SEARCH_PATHS% C:\nodejs"
set "NODE_SEARCH_PATHS=%NODE_SEARCH_PATHS% C:\Program Files\nodejs"

REM Check nvm-windows paths
if exist "%APPDATA%\nvm" (
    for /d %%d in ("%APPDATA%\nvm\v*") do (
        if exist "%%d\node.exe" (
            echo Found Node.js at: %%d
            set "PATH=%%d;%PATH%"
            goto :node_found
        )
    )
)

REM Check each common path
for %%p in (%NODE_SEARCH_PATHS%) do (
    if exist "%%~p\node.exe" (
        echo Found Node.js at: %%~p
        set "PATH=%%~p;%PATH%"
        goto :node_found
    )
)

REM Search user Downloads folder (in case user downloaded but didn't install)
for /d %%d in ("%USERPROFILE%\Downloads\node-v*") do (
    if exist "%%d\node.exe" (
        echo Found Node.js at: %%d
        set "PATH=%%d;%PATH%"
        goto :node_found
    )
)

REM Not found anywhere
echo.
echo ========================================
echo   Node.js not found!
echo   找不到 Node.js！
echo.
echo   Please install Node.js from:
echo   請從以下網址安裝 Node.js：
echo   https://nodejs.org/
echo.
echo   Or if already installed, add to PATH.
echo   如果已安裝，請將 Node.js 加入系統 PATH。
echo ========================================
echo.
pause
exit /b 1

:node_found
REM Verify node works
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Node.js found but cannot execute. Check installation.
    echo 找到 Node.js 但無法執行，請檢查安裝。
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do echo Node.js %%v

REM Check if node_modules exists
if not exist "node_modules" (
    echo.
    echo Installing dependencies...
    echo 安裝依賴套件...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo npm install failed!
        echo npm install 失敗！
        pause
        exit /b 1
    )
)

REM Check if .env exists
if not exist ".env" (
    echo.
    echo First time setup needed!
    echo 首次使用需要設定！
    echo.
    node setup.js
)

REM Start Bridge
echo.
echo Starting Bridge...
echo 啟動 Bridge...
echo.
node bridge.js
pause
