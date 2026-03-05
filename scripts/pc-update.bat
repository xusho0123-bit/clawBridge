@echo off
chcp 65001 >nul
title ClawBridge PC 安裝/更新腳本

echo.
echo ============================================
echo   ClawBridge - PC 安裝/更新腳本
echo ============================================
echo.

:: 檢查 git
where git >nul 2>&1
if errorlevel 1 (
    echo [錯誤] 找不到 Git！
    echo 請先安裝 Git: https://git-scm.com/download/win
    echo 安裝時全部選預設就好。
    pause
    exit /b 1
)

:: 檢查 node
where node >nul 2>&1
if errorlevel 1 (
    echo [錯誤] 找不到 Node.js！
    echo 請先安裝 Node.js: https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Git 已安裝
echo [OK] Node.js 已安裝
echo.

:: 判斷是全新安裝還是更新
if exist "package.json" (
    echo 偵測到現有安裝，執行更新...
    echo.
    goto :UPDATE
) else if exist "clawBridge\package.json" (
    echo 偵測到 clawBridge 資料夾，進入更新...
    cd clawBridge
    goto :UPDATE
) else (
    echo 全新安裝，開始 clone...
    echo.
    goto :INSTALL
)

:INSTALL
echo [1/3] 從 GitHub 下載...
git clone https://github.com/xusho0123-bit/clawBridge.git
if errorlevel 1 (
    echo [錯誤] Clone 失敗！請檢查網路連線。
    pause
    exit /b 1
)
cd clawBridge

echo [2/3] 安裝依賴...
call npm install
if errorlevel 1 (
    echo [錯誤] npm install 失敗！
    pause
    exit /b 1
)

echo [3/3] 建立設定檔...
if not exist ".env" (
    copy .env.example .env
    echo.
    echo ============================================
    echo   重要！請編輯 .env 填入以下資訊：
    echo ============================================
    echo.
    echo   1. TELEGRAM_BOT_TOKEN=你的Bot Token
    echo   2. ALLOWED_USER_ID=你的TG用戶ID
    echo   3. PROJECT_PATH=Antigravity IDE 的專案路徑
    echo   4. AI_MODEL=MODEL_GOOGLE_GEMINI_2_5_PRO
    echo.
    echo   編輯完成後，執行 start.bat 啟動
    echo.
    notepad .env
) else (
    echo .env 已存在，跳過。
)
echo.
echo ✅ 安裝完成！
pause
exit /b 0

:UPDATE
echo [1/2] 從 GitHub 拉取更新...
git stash >nul 2>&1
git pull origin main
if errorlevel 1 (
    echo [警告] git pull 失敗，嘗試強制更新...
    git fetch origin
    git reset --hard origin/main
)
git stash pop >nul 2>&1

echo [2/2] 更新依賴...
call npm install

echo.
echo ============================================
echo   ✅ 更新完成！
echo ============================================
echo.
echo   請檢查 .env 是否需要新增設定：
echo   - AI_MODEL=MODEL_GOOGLE_GEMINI_2_5_PRO
echo   - SYSTEM_PROMPT=（見 .env.example）
echo.
echo   重啟 Bridge 即可使用新版。
echo.
pause
exit /b 0
