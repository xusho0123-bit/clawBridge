@echo off
chcp 65001 >nul
echo ===================================
echo   Cursor / Antigravity Auto-Approve
echo   一鍵開啟所有自動核准
echo ===================================

:: Cursor settings path
set "CURSOR_SETTINGS=%APPDATA%\Cursor\User\settings.json"
:: Antigravity settings path
set "AG_SETTINGS=%APPDATA%\Antigravity\User\settings.json"

:: Try Cursor first, then Antigravity
set "TARGET="
if exist "%CURSOR_SETTINGS%" (
    set "TARGET=%CURSOR_SETTINGS%"
    echo [OK] 找到 Cursor 設定檔
) else if exist "%AG_SETTINGS%" (
    set "TARGET=%AG_SETTINGS%"
    echo [OK] 找到 Antigravity 設定檔
) else (
    echo [ERROR] 找不到 Cursor 或 Antigravity 設定檔
    echo 嘗試路徑：
    echo   %CURSOR_SETTINGS%
    echo   %AG_SETTINGS%
    pause
    exit /b 1
)

:: Backup
copy "%TARGET%" "%TARGET%.bak" >nul 2>&1
echo [OK] 已備份原設定 → settings.json.bak

:: Use PowerShell to modify JSON
powershell -NoProfile -Command ^
  "$f = '%TARGET%'.Replace('\','\\');" ^
  "$json = Get-Content $f -Raw | ConvertFrom-Json;" ^
  "$props = @{" ^
  "  'chat.tools.edits.autoApprove' = $true;" ^
  "  'chat.tools.urls.autoApprove' = $true;" ^
  "  'chat.tools.terminal.autoApprove' = $true;" ^
  "  'chat.tools.global.autoApprove' = $true;" ^
  "  'chat.tools.global.autoApprove.optIn' = $true;" ^
  "  'chat.agent.terminal.autoApprove' = $true;" ^
  "  'chat.agent.enabled' = $true" ^
  "};" ^
  "foreach ($k in $props.Keys) {" ^
  "  if ($json.PSObject.Properties[$k]) {" ^
  "    $json.$k = $props[$k]" ^
  "  } else {" ^
  "    $json | Add-Member -NotePropertyName $k -NotePropertyValue $props[$k]" ^
  "  }" ^
  "};" ^
  "$json | ConvertTo-Json -Depth 10 | Set-Content $f -Encoding UTF8;" ^
  "Write-Host '[OK] 已寫入所有 autoApprove 設定'"

echo.
echo ===================================
echo   完成！請重啟 Cursor / Antigravity
echo ===================================
pause
