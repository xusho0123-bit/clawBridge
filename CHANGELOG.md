# Antigravity Bridge - 更新紀錄

## v2.4.0 (2026-03-04)

### 新功能
- **對話記錄持久化** — 重啟 Bridge 後自動恢復對話，不用重新開始
  - `data/session.json` 保存 cascade ID
  - `data/history.json` 保存訊息紀錄（最多 200 則）
- **串流回覆優化** — AI 回覆時即時顯示進度
  - 打字指示器（每 4 秒刷新）
  - 時間節流（每 3 秒更新一次訊息，避免 TG 限速）
  - ⏳ 指示器顯示 AI 仍在思考
- **自動重連 Watchdog** — 每 30 秒檢查 IDE 連線
  - 斷線自動重連 + Telegram 通知
  - 恢復連線也會通知
- **多用戶支援** — `ALLOWED_USER_ID` 支援逗號分隔多個 ID
- **排程功能** — 每日定時發送訊息給 AI
  - `/schedule add HH:MM 訊息` 新增排程
  - `/schedule` 查看排程列表
  - `/schedule remove <id>` 刪除排程
  - 每 15 秒自動檢查 + 防重複觸發
- **靜態貼圖辨識** — .webp 貼圖直接當圖片送 AI 辨識
- **Windows 相容** — IDE settings 路徑跨平台支援

### 修復
- 修正 `isStaticSticker` 變數宣告順序（const 不會 hoisting）
- **Watchdog 通知優化** — 斷線最多通知 2 次（即時 + 5 分鐘後），不再洗版
- **start.bat Node.js 自動偵測** — 自動搜尋常見安裝路徑（Program Files、nvm、Downloads 等），不依賴系統 PATH

### 暫時停用
- `/menu` inline 按鈕選單（待修復 reply_markup 問題）

---

## v2.3.0

### 核心功能
- **Telegram ↔ Antigravity IDE 橋接** — 透過 Connect Protocol API 通訊
- **圖片辨識** — 圖片透過 media field (inline base64) 直接送 AI
- **PDF 讀取** — PDF 透過 media field 直接送 AI
- **語音辨識** — 語音訊息透過 Whisper STT 轉文字後送 AI
- **檔案處理** — 文字檔/程式碼透過 VIEW_FILE 讓 AI 讀取
- **訊息佇列** — 一次處理一個，避免並發問題
- **自動重連** — 連線錯誤時自動重試
- **權限控制** — /yolo, /safe, /approve 控制 IDE 自動核准
- **AI 媒體回傳** — AI 回覆中的 MEDIA: 標籤自動送出檔案
- **跨平台偵測** — macOS (ps/lsof) + Windows (PowerShell/netstat)
- **部署工具** — deploy.command (macOS) + deploy.bat (Windows)
- **System Prompt** — 可自訂 AI 系統提示詞

### 指令
- `/start`, `/help` — 使用說明
- `/status` — 連線狀態 + 權限狀態
- `/newchat` — 開始新對話
- `/reconnect` — 手動重新連線
- `/yolo` — 全部自動核准
- `/safe` — 安全模式
- `/approve <type> <on|off>` — 個別權限控制
