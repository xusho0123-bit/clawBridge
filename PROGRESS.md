# Antigravity Bridge — 開發進度

> 最後更新：2026-03-14

## 專案基本資訊

| 項目 | 值 |
|------|-----|
| GitHub | https://github.com/xusho0123-bit/clawBridge |
| 目前版本 | v3.2.0 |
| 開發時間 | 2026-03-05 ~ 至今（10 天） |
| 程式碼行數 | ~2,956 行 |
| 依賴數量 | 2（dotenv, node-telegram-bot-api） |

---

## 版本歷程

### ✅ v2.3.0 — 基礎版（2026-03-05）

最初版本，核心功能建立。

- [x] Telegram ↔ IDE Language Server 橋接
- [x] Connect Protocol RPC 通訊
- [x] 圖片辨識（base64 inline）
- [x] PDF 讀取
- [x] 語音辨識（Whisper STT）
- [x] 檔案處理（VIEW_FILE）
- [x] 訊息佇列（防並發）
- [x] 自動重連
- [x] 權限控制（/yolo, /safe, /approve）
- [x] AI 媒體回傳
- [x] 跨平台偵測（macOS + Windows）
- [x] System Prompt 自訂

### ✅ v2.4.0 — 穩定性改進（2026-03-04）

- [x] 對話記錄持久化（session.json + history.json）
- [x] 串流回覆即時顯示（3 秒節流 + ⏳ 指示器）
- [x] 自動重連 Watchdog（30 秒檢查 + 通知）
- [x] 多用戶支援（ALLOWED_USER_ID 逗號分隔）
- [x] 排程功能（/schedule）
- [x] 靜態貼圖辨識（.webp）
- [x] Windows start.bat Node.js 自動偵測

### ✅ v2.5.0 — 記憶系統（2026-03-05）

- [x] 📌 釘選 Pins（常駐注入，10 條 × 200 字）
- [x] 📝 筆記 Notes（關鍵字匹配，50 條 × 500 字）
- [x] 🔍 歷史回顧 Recall（搜尋歷史對話）
- [x] AI 自動記憶（REMEMBER/RECALL 標記）
- [x] CJK N-gram 中文關鍵字匹配
- [x] 修復「無文字回覆」bug（滑動窗口問題）

### ✅ v2.6.0 — 真串流 + 權限（2026-03-05）

- [x] StreamCascadeReactiveUpdates 即時串流
- [x] 二進位 framing + diff 解析
- [x] 300ms 節流（從 3 秒大幅改善）
- [x] 自動 fallback 到 polling
- [x] 權限 Inline 按鈕（Allow/Deny）
- [x] 4 種權限類型偵測
- [x] HandleCascadeUserInteraction API
- [x] YOLO 模式 + 個別權限自動核准
- [x] 多模型切換（/model + inline 按鈕）
- [x] 取消 AI 執行（/cancel）

### ✅ v3.0.0 — 穩定性 + 模組化 + Bug 全修（2026-03-07）

- [x] 串流超時保護（30 秒無資料自動斷流）
- [x] 即時取消（AbortController）
- [x] 快速重連（5 秒 → 30 秒）
- [x] 部分文字保留（超時不丟棄）
- [x] telegram.js 拆為 8 模組（lib/telegram/）
- [x] 修復 P0: Polling fallback 權限處理
- [x] 修復 P0: useStreaming 永久 false
- [x] 修復 P1: Timeout 不考慮權限等待
- [x] 修復 P1: Replay 漏權限
- [x] 修復 P1: 重複回應（replayBaseline）

### ✅ v3.1.0 — 串流調查（2026-03-08）

- [x] 確認 StreamCascadeReactiveUpdates 被 LS 禁用
- [x] 確認 HTTP/2 無法繞過（LS 層級限制）
- [x] 暫時使用 polling fallback

### ✅ v3.2.0 — StreamAgentStateUpdates 突破（2026-03-14）

- [x] 逆向 LS binary 發現 StreamAgentStateUpdates API
- [x] 實作 createAgentStream() 串流處理
- [x] 三層 fallback：AgentStream → Polling（ReactiveUpdates 已棄用）
- [x] 回應時間 < 0.5 秒（polling 約 3 秒）
- [x] 串流內直接偵測 WAITING 權限
- [x] thinking 欄位即時顯示
- [x] token usage 追蹤
- [x] 端對端驗證通過

---

## 測試紀錄

### 2026-03-07 測試結果

| 測試項目 | 結果 | 備註 |
|----------|------|------|
| 基本文字回覆 | ✅ 通過 | 串流正常 |
| YOLO 自動核准 | ✅ 通過 | IDE 閃過同意畫面，Bridge 自動核准 |
| `/safe` + `ls` 指令 | ⚠️ 跳過 | IDE 有 "Always run" 記憶，不觸發 WAITING |
| 檔案編輯 diff review | ✅ 資訊確認 | 非 WAITING 狀態，是 IDE diff review UI |
| 串流 permissionWait | ℹ️ 未偵測到 | 測試場景未觸發 WAITING |

---

## 未來規劃

### 近期（v3.3）

- [ ] AgentStream WAITING 權限實戰測試
- [ ] thinking 欄位顯示到 Telegram
- [ ] 單元測試覆蓋 AgentStream + polling + permission 場景
- [ ] Telegram 訊息長度處理（超過 4096 字自動分段）

### 中期

- [ ] Web Dashboard（瀏覽器管理介面）
- [ ] 多 IDE 實例支援
- [ ] 對話分支管理
- [ ] 檔案上傳到 IDE 專案

### 長期

- [ ] Docker 容器化部署
- [ ] 團隊共用（多使用者 + 權限管理）
- [ ] 插件系統
- [ ] 其他 IM 平台支援（Discord, LINE 等）

---

## 開發規則速查

> 詳見 `CLAUDE.md` 的「開發規則」章節

1. **Fallback 路徑必須有同等核心功能**
2. **降級 Flag 必須有恢復機制**
3. **Timeout 必須區分「等機器」和「等人」**
4. **Critical Callback 要確認有被觸發**
5. **Replay 要記錄被跳過的 Critical 事件**
6. **測試必須覆蓋 Degraded Mode**

---

## Bug 報告

- 完整 Bug 報告見：`BUG_REPORT_2026-03-07.md`
