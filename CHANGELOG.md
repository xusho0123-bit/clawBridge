# Antigravity Bridge - 更新紀錄

## v2.6.0 (2026-03-05)

### 重大改進
- **🔥 真串流取代 Polling** — 使用 `StreamCascadeReactiveUpdates` API
  - 從 0.8s polling + 3s TG 節流 → 即時 HTTP chunked + 300ms TG 節流
  - 二進位 framing (Connect protocol) + protobuf-like diff 解析
  - 自動 fallback：如果串流 API 不可用，退回 polling 模式
- **⚡ 串流節流 300ms** — AI 回覆幾乎即時顯示在 Telegram（原本 3 秒）
- **🔐 權限 Inline 按鈕** — AI 需要執行指令/編輯檔案時，TG 發送 Allow/Deny 按鈕
  - 支援 4 種權限：run_command、file、browser、mcp
  - YOLO 模式自動核准，個別設定也會自動核准
  - 使用 `HandleCascadeUserInteraction` API
- **🤖 多模型切換** — `/model` 指令或 inline 按鈕切換 AI 模型
  - 也支援 `/model <name>` 直接指定模型名
- **⛔ 取消 AI 執行** — `/cancel` 即時停止 AI（使用 `CancelCascadeInvocation` API）

### 新指令
- `/cancel` — 取消 AI 執行
- `/model` — 切換 AI 模型（inline 按鈕選單）
- `/model <name>` — 直接指定模型
- `/cascades` — 列出所有對話

### 技術改進
- `lib/rpc.js` 大幅重寫：新增 `streamFetch`, `parseStreamFrame`, `walkDiff`
- 新增 `cancelCascade()`, `handlePermission()`, `listCascades()`, `deleteCascade()` API
- Polling 邏輯封裝為 `createPollingFallback()` 作為 fallback
- `lib/telegram.js`：新增權限 callback_query handler + 模型選擇 handler

### 致謝
- 感謝 [@joeIvan2 (GagaClaw)](https://github.com/joeIvan2/gagaclaw) 的開源分享，
  讓我發現 `StreamCascadeReactiveUpdates`、`HandleCascadeUserInteraction` 等 API

---

## v2.5.0 (2026-03-05)

### 新功能
- **三層記憶系統** — AI 有長期記憶了！
  - 📌 **釘選 (Pins)** — 常駐知識，每次對話都注入 AI（最多 10 條）
  - 📝 **筆記 (Notes)** — 關鍵字匹配的知識庫（最多 50 條，帶標籤）
  - 🔍 **歷史回顧 (Recall)** — 搜尋過去對話紀錄
  - AI 自動記憶：回覆中 `REMEMBER: [tag] content` 自動存為筆記
  - AI 主動回顧：回覆中 `RECALL: keyword` 搜尋歷史
  - CJK N-gram 中文關鍵字匹配支援

### 新指令
- `/pin` — 管理釘選（add/remove/clear）
- `/note` — 管理筆記（add/remove/search）
- `/recall 關鍵字` — 搜尋歷史對話
- `/memory` — 記憶總覽

### 修復
- **修復「無文字回覆」bug** — 根本原因：GetCascadeTrajectory API 只回傳 ~100 步的滑動窗口，
  當對話超過 100 步時 polling 邏輯無法找到新回覆。
  改為從陣列尾端掃描 + 比對 snapshot 文字來偵測新回覆。

---

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
