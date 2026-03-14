# Antigravity Bridge — 專案規格書

> 最後更新：2026-03-14
> 版本：v3.1

## 一、專案概述

**Antigravity Bridge** 是一個 Node.js 應用程式，將 Telegram 與 Antigravity IDE 內建的 AI Language Server 橋接起來，讓使用者可以**用手機遠端操控桌面 AI**。

### 核心架構

```
手機 Telegram App
    ↕  Telegram Bot API（HTTPS）
Antigravity Bridge（本專案，本機執行）
    ↕  Connect Protocol（HTTPS/JSON, localhost）
Antigravity IDE Language Server（本機）
    ↕  Cloud API
AI Model（雲端）
```

### 設計理念

- **零 API Key**：直接使用 IDE 的 Language Server，不需要額外的 AI API key
- **自動偵測**：自動讀取 IDE 的 CSRF token 和 port，不需手動設定
- **輕量依賴**：僅 2 個 npm 套件（`dotenv` + `node-telegram-bot-api`）
- **跨平台**：macOS / Windows / Linux

---

## 二、功能清單

### 2.1 核心通訊

| 功能 | 說明 | 實作檔案 |
|------|------|----------|
| Connect Protocol RPC | HTTPS/JSON 與 Language Server 通訊 | `lib/rpc.js` |
| 真串流回覆 | `StreamCascadeReactiveUpdates` 即時回覆 | `lib/rpc.js` |
| Polling Fallback | 串流失敗時自動降級為輪詢 | `lib/rpc.js` |
| 自動偵測 CSRF/Port | 從 IDE 設定檔讀取認證資訊 | `lib/detect.js` |
| 自動重連 Watchdog | 自適應檢查（斷線 5s / 正常 30s），自動重連 | `lib/telegram/watchdog.js` |
| 串流超時保護 | 30 秒無資料自動斷流 + 回傳部分文字 | `lib/rpc.js` |
| 即時取消 | AbortController 秒斷串流/輪詢 | `lib/rpc.js` |

### 2.2 使用者功能

| # | 功能 | 說明 |
|---|------|------|
| 1 | 📷 圖片辨識 | 傳圖片給 Bot，AI 直接辨識（inline base64） |
| 2 | 📄 PDF 閱讀 | 傳 PDF 給 Bot，AI 讀取內容 |
| 3 | 🎤 語音輸入 (STT) | 語音訊息 → Whisper 轉文字 → AI |
| 4 | 🔊 語音輸出 (TTS) | AI 可用 edge-tts 語音回覆 |
| 5 | 💻 終端指令 | AI 可執行終端指令（透過 OpenClaw） |
| 6 | ✏️ 檔案編輯 | AI 可讀寫檔案 |
| 7 | 📎 檔案處理 | 傳文字檔/程式碼給 Bot |
| 8 | 🧠 三層記憶 | 釘選 + 筆記 + 歷史搜尋 |
| 9 | ⏰ 排程功能 | 每日定時發送訊息給 AI |
| 10 | 🔐 遠端權限控制 | 從 Telegram 控制 IDE 核准設定 |
| 11 | 🤖 多模型切換 | `/model` 選擇不同 AI 模型 |
| 12 | ⛔ 取消執行 | `/cancel` 即時停止 AI |

### 2.3 記憶系統

三層架構：

| 層級 | 名稱 | 注入方式 | 限制 | 存檔 |
|------|------|----------|------|------|
| Layer 1 | 📌 釘選 (Pins) | 每次對話自動注入 | 10 條 × 200 字 | `data/pins.json` |
| Layer 2 | 📝 筆記 (Notes) | 關鍵字自動匹配（最多 3 條） | 50 條 × 500 字 | `data/notes.json` |
| Layer 3 | 🔍 歷史回顧 (Recall) | `/recall` 或 AI `RECALL:` 觸發 | 200 則對話 | `data/history.json` |

AI 自動記憶標記：
- `REMEMBER: [tag1,tag2] 內容` → 自動存為筆記
- `RECALL: 關鍵字` → 搜尋歷史對話

### 2.4 權限控制系統

```
AI 需要執行工具（終端/檔案/瀏覽器/MCP）
    ↓
IDE Language Server 發出 WAITING 狀態（status = 9）
    ↓
Bridge 偵測到 → 發送 Telegram Inline Button [✅ Allow] [❌ Deny]
    ↓
使用者點選 → Bridge 呼叫 HandleCascadeUserInteraction API
    ↓
AI 繼續執行
```

四種權限類型：
- `run_command`（stepType 21）：終端指令
- `file`：檔案編輯
- `browser`：瀏覽器操作
- `mcp`（stepType 38）：MCP 工具呼叫

模式：
- `/yolo`：全部自動核准
- `/safe`：全部需要手動核准
- `/approve <type> <on|off>`：個別控制

---

## 三、技術架構

### 3.1 檔案結構

```
antigravity-bridge/
├── bridge.js              # 主程式入口（75 行）
├── lib/
│   ├── rpc.js             # Connect Protocol RPC Client（922 行）⭐ 核心
│   ├── telegram/          # Telegram Bot（8 模組，共 1390 行）⭐ 核心
│   │   ├── index.js       # 入口 + message handler + scheduler（236 行）
│   │   ├── ctx.js         # 共享 context 物件（20 行）
│   │   ├── settings.js    # IDE 設定讀寫（28 行）
│   │   ├── media.js       # MIME/下載/STT（184 行）
│   │   ├── queue.js       # 訊息佇列 + AI 互動（233 行）
│   │   ├── commands.js    # 所有 /指令（458 行）
│   │   ├── callbacks.js   # Inline button callback（152 行）
│   │   └── watchdog.js    # 健康檢查 + 自適應重連（79 行）
│   ├── detect.js          # CSRF/Port 自動偵測（161 行）
│   ├── memory.js          # 三層記憶系統（299 行）
│   ├── history.js         # 對話持久化（58 行）
│   └── scheduler.js       # 排程功能（51 行）
├── data/                  # 執行時資料（自動建立）
│   ├── session.json       # Cascade 狀態
│   ├── history.json       # 對話紀錄
│   ├── pins.json          # 釘選
│   ├── notes.json         # 筆記
│   └── models.json        # AI 模型 ID 對照表
├── tools/                 # 工具腳本
├── scripts/               # 平台腳本（pc-update.bat 等）
├── setup.js               # 設定精靈
├── start.command           # macOS 一鍵啟動
├── start.bat              # Windows 一鍵啟動
├── restart.command         # macOS 全重啟
├── restart.bat            # Windows 全重啟
├── package.json           # 依賴：dotenv, node-telegram-bot-api
└── .env                   # 設定檔（不入版控）
```

**總行數**：~2,956 行

### 3.2 核心模組說明

#### `lib/rpc.js` — Connect Protocol RPC Client

負責與 Antigravity IDE Language Server 通訊的核心模組。

**主要 API**：

| 函數 | Connect API | 說明 |
|------|------------|------|
| `sendMessage()` | `SendCascadeMessage` | 發送訊息到 AI |
| `streamResponse()` | `StreamCascadeReactiveUpdates` | 串流接收回覆 |
| `pollResponse()` | `GetCascadeTrajectory` | 輪詢接收回覆（fallback） |
| `handlePermission()` | `HandleCascadeUserInteraction` | 回應權限請求 |
| `cancelCascade()` | `CancelCascadeInvocation` | 取消 AI 執行 |
| `listCascades()` | `ListCascades` | 列出所有對話 |
| `deleteCascade()` | `DeleteCascade` | 刪除對話 |
| `resetCascade()` | — | 重置本地狀態 |

**串流機制**：
- 使用二進位 framing（Connect Protocol 格式）
- 5-byte header（flags + length）+ JSON payload
- 差異式更新（diff-based），需 `walkDiff()` 解析
- 300ms 節流更新到 Telegram

**Fallback 機制**：
- 串流失敗 → 自動切換到 polling
- 每次新 cascade 重試串流（v2.6 修復）
- Polling 使用 800ms 間隔輪詢 `GetCascadeTrajectory`

**穩定性保護（v3.0 新增）**：
- **串流超時**：30 秒無新資料自動斷流，回傳已收到的部分文字 + 警告標記
- **Socket 超時**：`socket.setTimeout(60s)` 防止底層連線掛死
- **部分文字保留**：超時/斷線時不丟棄已收到的內容，加 `⚠ *回應可能不完整*`
- **即時取消**：`/cancel` 透過 AbortController signal 秒斷串流和輪詢
- **Replay 過濾**：`baselineSteps` 防止訂閱時的初始 replay 被誤判為新回覆
- **卡住偵測**：queue 處理超過 `POLL_TIMEOUT + 60s` 自動 force-reset

#### `lib/telegram/` — Telegram Bot（模組化架構）

v3.0 將原本 1365 行的 `telegram.js` 拆分為 8 個模組，透過共享 context 物件通訊。

| 模組 | 職責 |
|------|------|
| `index.js` | 入口：建立 bot、組裝模組、message handler、排程器 |
| `ctx.js` | 共享 context 物件（bot, config, rpc, queue, processing 狀態） |
| `settings.js` | IDE 設定讀寫（`readIdeSettings` / `writeIdeSettings` / `APPROVE_KEYS`） |
| `media.js` | MIME 偵測、檔案下載（60s timeout）、Whisper STT、extractFileInfo |
| `queue.js` | 訊息佇列、processQueue、串流回覆更新、權限 UI、錯誤處理、卡住偵測 |
| `commands.js` | 所有 /指令路由（help, newchat, model, cancel, pin, note, recall, memory, approve, yolo, safe, schedule, cascades） |
| `callbacks.js` | Inline button callback（權限 pa_/pd_、模型選擇 model_、快捷選單） |
| `watchdog.js` | 健康檢查 + 自適應重連（斷線 5s × 2min → 正常 30s） |

**模組通訊模式**：
```javascript
const ctx = createContext(bot, config, rpc, reconnectFn);
setupQueue(ctx);        // 掛 ctx.processQueue
setupCommands(ctx);     // 返回 handleCommand 函數
setupCallbacks(ctx);    // 註冊 callback_query listener
setupWatchdog(ctx);     // 啟動自適應 setTimeout
```

#### `lib/detect.js` — 自動偵測

**偵測策略**：
- **macOS**: 讀取 `~/.antigravity/settings.json` 取得 CSRF token，用 `lsof` 偵測 port
- **Windows**: 讀取 `%APPDATA%/antigravity/settings.json`，用 PowerShell `Get-NetTCPConnection` 偵測 port
- 自動 retry，timeout 時重新偵測

### 3.3 通訊協定

**Connect Protocol**：
- 基礎：HTTPS + JSON（POST）
- 認證：`x-codeium-csrf-token` header
- Content-Type：`application/json`
- 串流：`application/connect+json`，chunked transfer encoding
- Base URL：`https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/`

### 3.4 Language Server 通訊架構

> 以下由 Antigravity AI（緋）親自說明，結合逆向工程驗證

#### 完整通訊路徑

```
IDE (Antigravity 介面)
    ↕  gRPC / Connect 協定
Local Language Server (本機代理)
    ↕  streamGenerateContent?alt=sse
Google LLM (雲端回覆)
```

在 IDE 內送出訊息時，實際是打給本機端的 Language Server 服務（走 gRPC / Connect 協定），
再由 LS 把完整 Context 打包送往雲端的 LLM API。

#### 核心 Session 識別碼

| 識別碼 | 層級 | 說明 |
|--------|------|------|
| `cascadeId` | 對話會話 | 代表「整層對話」的 Session ID。同一個 cascadeId 內 LLM 記得上下文 |
| `trajectoryId` | 單趟任務 | 代表「單次問答 / 單趟任務」的軌跡 ID。AI 開始思考或執行工具時產生 |
| `stepIndex` | 子步驟 | 單次任務中的步驟序號（如：看檔案 = Step 1、跑終端 = Step 2） |

#### 主要 RPC 方法

| 方法 | 用途 |
|------|------|
| `StartCascade` | 建立全新對話 Session（產生新的 cascadeId） |
| `SendUserCascadeMessage` | 把文字、圖片、System Prompt 打包寫入 Context，送進目前 cascadeId |
| `StreamCascadeReactiveUpdates` | **最關鍵的串流函數**。IDE 透過此函數與 Server 保持長連線，動態解析封包 |
| `GetCascadeTrajectory` | 輪詢式取得回應（Bridge fallback 用） |
| `HandleCascadeUserInteraction` | 回應權限請求（Allow/Deny） |
| `CancelCascadeInvocation` | 取消 AI 執行 |

#### StreamCascadeReactiveUpdates 串流內容

串流使用二進制資料幀 (Binary Frame) + protobuf 格式，動態解析出：
- `<thinking>` — AI 思考過程
- `response` — 回答文字
- `toolCalls` — AI 要執行的工具（run_command, file, browser）
- `status: 9 (WAITING)` — 等待使用者權限核准

#### 逆向工程補充（2026-03-14）

**LS 程序與 Port**：

| Port | 協定 | 用途 |
|------|------|------|
| `{httpsPort}` | HTTPS (HTTP/1.1) | Bridge RPC 連線（JSON format） |
| `{httpPort}` | HTTP (明文) | 同上，無 TLS |
| `{lspPort}` | HTTPS? | LSP 相關（未確認） |
| `{extensionServerPort}` | VS Code IPC | Extension Host 內部通訊（非 RPC） |

**IDE Extension 的連線方式**（與 Bridge 不同）：
```
IDE Extension (dist/extension.js)
  ↓ @connectrpc/connect — createConnectTransport({
  ↓   baseUrl: `https://${host}`,
  ↓   useBinaryFormat: true,   ← 二進位 protobuf（非 JSON）
  ↓   httpVersion: "2",        ← HTTP/2（非 HTTP/1.1）
  ↓   nodeOptions: { ca: cert.pem }
  ↓ })
  ↓ createClient(LanguageServerService, transport)
Language Server (Go binary)
  ↓ streamGenerateContent?alt=sse
Google Cloud API (daily-cloudcode-pa.googleapis.com)
```

**Bridge 的連線方式**（目前）：
```
Bridge (lib/rpc.js)
  ↓ https.request({
  ↓   Content-Type: 'application/json',   ← JSON format
  ↓   HTTP/1.1                            ← 非 HTTP/2
  ↓   rejectUnauthorized: false           ← 跳過 TLS 驗證
  ↓ })
Language Server
```

**StreamCascadeReactiveUpdates 歷史**：
- 2026-03-07 之前：可用（bridge-debug.log 有 7 次成功 `Stream done`）
- 2026-03-08 起：LS `cascade_manager.go:842` 硬編碼 `Reactive state is disabled`，至今仍然如此

**🎯 突破：StreamAgentStateUpdates（2026-03-14 發現）**：

LS binary 中存在另一個串流 API `StreamAgentStateUpdates`，**不受 reactive state 限制**！

```
請求格式：{ conversationId: cascadeId }  （注意欄位名是 conversationId）
Content-Type: application/connect+json（binary framing）
回應：即時 Binary Frame 串流
```

回應結構（每個 frame）：
```json
{
  "update": {
    "conversationId": "...",
    "trajectoryId": "...",
    "status": "CASCADE_RUN_STATUS_RUNNING | IDLE",
    "mainTrajectoryUpdate": {
      "stepsUpdate": {
        "indices": [3],
        "steps": [{
          "type": "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
          "status": "CORTEX_STEP_STATUS_GENERATING | DONE",
          "plannerResponse": {
            "modifiedResponse": "AI 回應文字（逐步增長）",
            "thinking": "AI 思考過程"
          }
        }]
      }
    }
  }
}
```

與舊 API 比較：

| | StreamCascadeReactiveUpdates | StreamAgentStateUpdates |
|---|---|---|
| 狀態 | ❌ disabled | ✅ 可用 |
| 輸入欄位 | `cascadeId` | `conversationId`（= cascadeId） |
| 回應格式 | diff-based（需 walkDiff） | 完整 update 物件（直接讀取） |
| 包含內容 | response text | thinking + response + status + token usage |
| 完成判斷 | 需解析 diff | `status: IDLE` + step `CORTEX_STEP_STATUS_DONE` |
| Step types | 需映射 | `USER_INPUT`, `PLANNER_RESPONSE`, `CHECKPOINT` |

**IDE 拿 AI 回應的實際方式**：
- IDE 透過 Extension Host 的內部 IPC 通道取得回應
- 不走 `StreamCascadeReactiveUpdates` 也不走 `GetCascadeTrajectory`
- LS log 中 IDE 的請求只出現 `Requesting planner` + `streamGenerateContent` 呼叫
- 外部程式（Bridge）無法存取 Extension Host 的 IPC 通道
- **Bridge 可改用 `StreamAgentStateUpdates` 取代 polling**

**Bridge 使用 Polling 的安全性**：
- `GetCascadeTrajectory` 是純本地操作，讀取 LS 記憶體中的 trajectory 資料
- 不觸發任何對外網路請求
- Google 只看到 LS 發出的 `streamGenerateContent` 請求，與 IDE 自身使用完全相同
- Google 無法區分請求來源是 IDE UI 還是 Bridge RPC

**潛在改進方向**：
1. ~~寫 Antigravity 擴充套件從內部存取 AI~~ — Extension API 不暴露 cascade 對話介面
2. ~~攔截 Extension Host IPC~~ — VS Code 內部協定，難以模擬
3. ~~攔截 Google Cloud SSE~~ — 需 MITM + CA 憑證，不實際
4. **保持 Polling** — 最穩定可靠，3 秒回應延遲可接受

### 3.5 依賴

| 套件 | 版本 | 用途 |
|------|------|------|
| `dotenv` | ^16.4.5 | .env 設定檔讀取 |
| `node-telegram-bot-api` | ^0.65.0 | Telegram Bot API |

選配（系統工具）：
- Python 3 + `openai-whisper`：語音辨識
- Python 3 + `edge-tts`：語音合成
- `ffmpeg`：音訊格式轉換

### 3.6 支援平台

| 平台 | 狀態 | 偵測方式 |
|------|------|----------|
| macOS | ✅ 完整測試 | `ps` + `lsof` |
| Windows | ✅ 支援 | PowerShell + netstat |
| Linux | ✅ 應可運行 | 同 macOS |

---

## 四、Telegram Bot 指令

### 基本

| 指令 | 說明 |
|------|------|
| `/start` `/help` `/？` | 使用說明 |
| `/status` | 連線狀態 + 記憶統計 |
| `/newchat` | 開新對話 |
| `/reconnect` | 重新偵測 Language Server |
| `/cancel` | 取消 AI 執行 |
| `/model` | 切換 AI 模型（inline 按鈕） |
| `/model <name>` | 直接指定模型 |

### 記憶

| 指令 | 說明 |
|------|------|
| `/pin` | 列出所有釘選 |
| `/pin add 文字` | 新增釘選 |
| `/pin remove <id>` | 刪除釘選 |
| `/pin clear` | 清除所有釘選 |
| `/note` | 列出所有筆記 |
| `/note add [tag] 內容` | 新增筆記 |
| `/note remove <id>` | 刪除筆記 |
| `/note search 關鍵字` | 搜尋筆記 |
| `/recall 關鍵字` | 搜尋歷史對話 |
| `/memory` | 記憶總覽 |

### 排程

| 指令 | 說明 |
|------|------|
| `/schedule` | 查看排程列表 |
| `/schedule add HH:MM 訊息` | 新增每日排程 |
| `/schedule remove <id>` | 刪除排程 |

### 權限

| 指令 | 說明 |
|------|------|
| `/yolo` | 全自動核准 |
| `/safe` | 恢復安全模式 |
| `/approve` | 查看目前設定 |
| `/approve <type> <on|off>` | 個別控制 |

---

## 五、.env 設定

| 變數 | 必填 | 預設 | 說明 |
|------|------|------|------|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | 從 @BotFather 取得 |
| `ALLOWED_USER_ID` | 建議 | — | 限制使用者 ID（逗號分隔） |
| `PROJECT_PATH` | — | — | 啟動時自動開專案 |
| `AI_MODEL` | — | `MODEL_PLACEHOLDER_M18` | AI 模型 ID |
| `POLL_TIMEOUT_MS` | — | `120000` | 回應超時（毫秒） |
| `WHISPER_MODEL` | — | `turbo` | Whisper STT 模型 |
| `WHISPER_LANGUAGE` | — | — | Whisper 語言代碼（如 `zh`），不設則自動偵測 |
| `SYSTEM_PROMPT` | — | （見 .env.example） | AI 系統提示詞 |

---

## 六、啟動腳本

| 腳本 | Mac | Windows | 用途 |
|------|-----|---------|------|
| start | `start.command` | `start.bat` | 重啟 Bridge（殺舊 → 清 session → 偵測 → 啟動） |
| restart | `restart.command` | `restart.bat` | 重啟全部（OpenClaw + IDE + Bridge） |
| pc-update | — | `scripts/pc-update.bat` | git pull 更新 |
| deploy | `deploy.command` | `deploy.bat` | 部署腳本 |
| setup | `npm run setup` | `npm run setup` | 互動式設定精靈 |

---

## 七、已知限制

1. **IDE 必須開專案**：只開 Launchpad 不夠，Language Server 不會啟動
2. **單一 Bridge 實例**：不能同時跑兩個 Bridge（409 Conflict）
3. **IDE "Always run" 策略**：IDE 層級的自動核准獨立於 Bridge，IDE 已記住的指令不會再觸發 WAITING
4. **Cascade 歷史滑動窗口**：`GetCascadeTrajectory` 只回傳約 100 步，長對話需從尾端掃描
5. **語音功能需額外安裝**：Python 3 + Whisper + edge-tts + ffmpeg
6. **模型 ID 固定**：只能用 `data/models.json` 中列出的 IDE 內部 enum 值

---

## 八、開發紀錄

| 日期 | 版本 | 內容 | Commit |
|------|------|------|--------|
| 2026-03-07 | v2.6 | 初版 SPEC.md、MCP 權限支援、記憶系統完善 | — |
| 2026-03-09 | v3.0 | 穩定性大改善 + 模組拆分（7 commits） | `a4dcb12`~`7f2488b` |
| 2026-03-14 | v3.1 | 修復 streaming fallback + LS 逆向工程分析 | — |
| 2026-03-14 | v3.2 | 🎯 發現並實裝 `StreamAgentStateUpdates`，即時串流恢復 | — |

### v3.2 變更明細（2026-03-14）

| # | 類型 | 說明 |
|---|------|------|
| 1 | feat | 逆向 LS binary 發現 `StreamAgentStateUpdates` API，取代被禁用的 `StreamCascadeReactiveUpdates` |
| 2 | feat | `rpc.js` 新增 `createAgentStream()` — 使用新 API 的串流實作 |
| 3 | refactor | `sendToAI()` 三層 fallback：AgentStream → Polling（ReactiveUpdates 已棄用） |
| 4 | docs | SPEC §3.4 新增完整通訊路徑說明 + StreamAgentStateUpdates 結構文件 |

**v3.1 → v3.2 前後對比**：

| 指標 | v3.1（修復前） | v3.2（突破後） |
|------|----------------|----------------|
| 回應方式 | Polling（800ms 間隔輪詢） | 即時串流（StreamAgentStateUpdates） |
| 回應延遲 | ~3 秒（等輪詢命中） | < 0.5 秒（即時推送） |
| 思考過程 | 不可見 | 串流中包含 `thinking` 欄位 |
| 完成判斷 | 輪詢 step status + 5s 穩定等待 | 即時 `CASCADE_RUN_STATUS_IDLE` + `DONE` |
| Token 用量 | 不可見 | 串流中包含 `inputTokens` / `outputTokens` |
| 閒置資源 | Watchdog 每 30s（OK） | 同（串流僅在等回應時開啟） |
| 權限偵測 | Polling 掃描 WAITING step | 串流即時偵測 WAITING status |
| Fallback | Polling（已運作） | AgentStream 失敗 → 自動 Polling |

**根因分析（v3.1）**：Antigravity 在 3/7~3/8 更新後，LS binary 的 `cascade_manager.go:842` 硬編碼關閉了 `reactive state`。`StreamCascadeReactiveUpdates` 立即回傳 error frame（flags=0x02），但舊版 `streamFetch` 只檢查 flags 不解析 payload，呼叫 `onEnd()` 時不帶 error。導致 `streamResponse` 的 Promise 永遠不 resolve/reject，掛到 5 分鐘 timeout 才 fallback 到 polling，此時 cascade 已過期（trajectory not found）。

**突破過程（v3.2）**：用 `strings` 掃描 LS binary 找到所有 RPC method → 發現 `StreamAgentStateUpdates` → 測試回 HTTP 200（不受 reactive state 限制）→ 找到正確的輸入欄位名（`conversationId` 而非 `cascadeId`）→ 完整端到端驗證成功。

### v3.1 變更明細（2026-03-14）

| # | 類型 | 說明 |
|---|------|------|
| 1 | fix | `streamFetch` 解析 end-of-stream frame 中的 error JSON，不再靜默失敗 |
| 2 | fix | 加 `streamPromise.catch(() => {})` 防止 unhandled rejection（stream 比 sendMessage 先 reject） |
| 3 | docs | SPEC 新增 §3.4 — LS 通訊架構逆向工程分析 |

### v3.0 變更明細（2026-03-09）

| # | 類型 | 說明 | Commit |
|---|------|------|--------|
| 1 | fix | Replay baseline filter — 防止訂閱時 late replay 被誤判 | `a4dcb12` |
| 2 | fix | Stream inactivity timeout (30s) + socket timeout (60s) | `23220d0` |
| 3 | fix | 超時/斷線回傳部分文字 + `⚠ *回應可能不完整*` 警告 | `97c43f7` |
| 4 | feat | AbortController — `/cancel` 秒斷串流和輪詢 | `ebb2dc6` |
| 5 | fix | Watchdog 自適應重連（斷線 5s × 2min → 正常 30s） | `88f19be` |
| 6 | fix | P1/P2 強化：下載 60s timeout、音檔清理、JSON 驗證、callback_data 截斷、BOT_TOKEN 驗證 | `8707264` |
| 7 | refactor | telegram.js (1365 行) 拆分為 8 個模組 (`lib/telegram/`) | `7f2488b` |
