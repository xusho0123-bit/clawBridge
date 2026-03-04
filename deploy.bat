@echo off
REM Antigravity Bridge — 複製專案到目標路徑
REM Deploy project to target path (excluding private files)
REM 雙擊此檔案即可使用 / Double-click to use

cd /d "%~dp0"

echo === Antigravity Bridge Deploy ===
echo.
echo 此工具會將專案複製到你指定的目標路徑
echo This tool copies the project to your target path
echo.
echo 排除項目 Excluded: .env, node_modules, downloads, .DS_Store, *.log, __pycache__
echo.

REM 讀取目標路徑
if "%~1"=="" (
    set /p TARGET="請輸入目標路徑 Enter target path: "
) else (
    set "TARGET=%~1"
)

if "%TARGET%"=="" (
    echo 未輸入路徑，取消。No path given, cancelled.
    pause
    exit /b 1
)

echo.
echo 來源 From: %~dp0
echo 目標 To:   %TARGET%\
echo.
set /p CONFIRM="確認複製？Continue? (y/N) "
if /i not "%CONFIRM%"=="y" (
    echo 取消。Cancelled.
    pause
    exit /b 0
)

echo.
echo Copying...

REM 使用 robocopy（Windows 內建，類似 rsync）
robocopy "%~dp0." "%TARGET%" /MIR /NFL /NDL /NJH /NJS ^
    /XD node_modules downloads __pycache__ .git ^
    /XF .env *.log *.pyc .DS_Store

if %ERRORLEVEL% LEQ 7 (
    echo.
    echo Done!
) else (
    echo.
    echo 複製過程有錯誤 Errors during copy.
)

echo.
echo 下一步 Next steps:
echo   cd %TARGET%
echo   npm install
echo   npm run setup      # 設定 .env (Bot Token 等)
echo   npm start
echo.
pause
