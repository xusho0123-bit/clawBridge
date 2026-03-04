# Antigravity Bridge — 研究記錄與待解問題

## 核心發現（已驗證）

### Connect Protocol API
Antigravity Language Server 使用 [Connect Protocol](https://connectrpc.com/) (HTTPS + JSON)。
所有 RPC 都走同一個 endpoint pattern：
```
POST https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/{method}
```

Headers:
```
Content-Type: application/json
x-codeium-csrf-token: {token}
connect-protocol-version: 1
```

### CSRF Token + Port 偵測
- **CSRF Token**: 從 `ps aux | grep csrf_token` 取得 `--csrf_token` 參數
- **Port**: 從 `lsof -iTCP -sTCP:LISTEN -nP | grep language` 取得
- **Port 驗證**: 呼叫 `GetCommandModelConfigs` 確認回應包含 `clientModelConfigs`
- **重要**: Antigravity IDE 必須開啟專案資料夾，Language Server 才會啟動。只開 Launchpad 不夠。

### 3 步 API Flow（對話核心）

```
1. StartCascade        → 建立對話 session（cascadeId = UUID）
2. SendUserCascadeMessage → 送出使用者訊息（必須帶 cascadeConfig + requestedModel）
3. GetCascadeTrajectory   → 輪詢 AI 回應（trajectory 包含所有 step）
```

#### StartCascade
```json
{
  "cascadeId": "uuid-here",
  "metadata": { "ideName": "antigravity" }
}
```

#### SendUserCascadeMessage
```json
{
  "cascadeId": "uuid-here",
  "items": [{ "text": "你好" }],
  "metadata": { "ideName": "antigravity" },
  "cascadeConfig": {
    "plannerConfig": {
      "conversational": {},
      "requestedModel": { "model": "MODEL_PLACEHOLDER_M18" }
    }
  }
}
```
**關鍵**: `cascadeConfig.plannerConfig.requestedModel` 是必要的，沒帶會失敗。

#### SendUserCascadeMessage — 圖片支援（media field）
```json
{
  "cascadeId": "uuid-here",
  "items": [{ "text": "描述這張圖片" }],
  "media": [{
    "mimeType": "image/jpeg",
    "inlineData": "base64-encoded-image-data..."
  }],
  "metadata": { "ideName": "antigravity" },
  "cascadeConfig": { ... }
}
```
**發現過程**: 透過 `strings` 分析 Language Server binary，找到 protobuf 定義。
`SendUserCascadeMessageRequest` 除了 `items` 之外，還有：
- `images` (legacy) — `ImageData` 格式：`{ base64Data, mimeType, caption }`。AI 收到但仍會觸發 VIEW_FILE tool call 導致卡住。
- `media` (modern) — `exa.codeium_common_pb.Media` 格式：`{ mimeType, inlineData }` (base64 bytes)。
  **這是正確的做法** — AI 直接辨識圖片，不需要 tool call，5 秒內回覆。

⚠ **注意**: `inlineData` 在 JSON 中是 base64 編碼的 bytes（protobuf `bytes` 型別在 JSON 中自動用 base64）。

#### GetCascadeTrajectory
```json
{
  "cascadeId": "uuid-here",
  "metadata": { "ideName": "antigravity" }
}
```
回應包含 `trajectory.steps[]`，每個 step 有 `type` 和 `status`。

### Trajectory 完整結構（已驗證）

一次完整的 AI 回應 trajectory 包含以下 step types：

```
USER_INPUT → CONVERSATION_HISTORY → EPHEMERAL_MESSAGE → PLANNER_RESPONSE → (tool calls) → PLANNER_RESPONSE → CHECKPOINT
```

#### 已知 Step Types
- `CORTEX_STEP_TYPE_USER_INPUT` — 使用者訊息
- `CORTEX_STEP_TYPE_CONVERSATION_HISTORY` — 對話歷史
- `CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE` — 系統暫時訊息
- `CORTEX_STEP_TYPE_PLANNER_RESPONSE` — AI 的文字回應
  - `.plannerResponse.response` = 回應文字
  - `.status` = `CORTEX_STEP_STATUS_GENERATING` → 生成中（有 partial text）
  - `.status` = `CORTEX_STEP_STATUS_DONE` → 完成
- `CORTEX_STEP_TYPE_LIST_DIRECTORY` — 目錄列表 tool call
- `CORTEX_STEP_TYPE_VIEW_FILE` — 檔案/圖片查看 tool call（圖片時會卡在 WAITING）
- `CORTEX_STEP_TYPE_RUN_COMMAND` — 執行終端指令 tool call
- `CORTEX_STEP_TYPE_COMMAND_STATUS` — 指令執行結果
- `CORTEX_STEP_TYPE_CHECKPOINT` — 檢查點

#### executorMetadatas
- `trajectory.executorMetadatas[]` — 每個 executor 的執行資訊
- `.terminationReason` = `EXECUTOR_TERMINATION_REASON_NO_TOOL_CALL` 等
- **重要**: executorMetadatas 只在整個 executor chain 完成後才出現
- 多步 tool call 時，executorMetadatas 會很慢才出現

#### Tool Call 行為
- 在 conversational 模式下，tool calls（如 LIST_DIRECTORY）會**自動執行**，不需授權
- 每個 tool call 會產生一個新的 PLANNER_RESPONSE step
- `numGeneratorInvocations: 2` 表示 AI 做了兩次生成（一次 thinking、一次 final answer）

### 已知 Models
- `MODEL_PLACEHOLDER_M18` — Gemini 3 Flash（預設）
- 其他 model ID 可透過 `GetCommandModelConfigs` 查詢

---

## 已解決的問題

### 1. 重複回應（Duplicate Responses）
**問題**: 同一個 cascade 的多個訊息，pollResponse 回傳舊訊息的 trajectory 資料。
**解法**: Snapshot-based approach — 發送訊息前記錄當前 step count 和 executor count，polling 時只看 snapshot 之後的新 steps。

### 2. 回應提早截斷（Premature Response Return）
**問題**: AI 做多步驟回應時，前一個 PLANNER_RESPONSE step 標記 DONE 導致提早返回。
**解法**: `isDone` 改成追蹤**最後一個** PLANNER_RESPONSE step 的狀態。

### 3. AI 回應 Timeout（Tool Call 場景）
**問題**: 複雜訊息觸發 tool calls 時，executorMetadatas 很慢才出現，120 秒 timeout。
**解法**: Stability fallback — 如果最後一個 PLANNER_RESPONSE step 狀態是 DONE，且回應文字 5 秒內沒變化，視為完成直接返回。
```javascript
// Primary: executorMetadatas.terminationReason 出現 → 立即返回
// Fallback: step DONE + text stable 5s → 返回
```

### 4. AI 回應內容偏離（講 workspace 專案進度）
**問題**: AI 預設會分析 workspace 裡的檔案，每次開新對話就總結專案進度。
**解法**: 加入 System Prompt 機制 — 在每個 cascade 的第一則訊息前加上 `[System Instructions]`，告訴 AI 自然對話、不要主動分析 workspace。
- `.env` 加 `SYSTEM_PROMPT` 變數
- `rpc.js` 的 `sendMessage()` 在 `isFirstMessage` 時 prepend

### 5. Telegram 409 衝突
**問題**: 多個 bot instance 用同一個 token 會 409 Conflict。
**解法**: start.command 啟動前先 kill 舊的 bridge process。

### 6. 連線斷開自動恢復
**問題**: IDE 重啟或切換專案時 LS port/CSRF 改變。
**解法**: 多層自動恢復：
- `telegram.js`: ECONNREFUSED → 自動呼叫 `reconnectFn()` 重新偵測
- `rpc.js`: cascade error (INTERNAL/404/400) → 自動 reset + retry
- Queue stuck detection: `pollTimeout + 60s` 後強制 reset

### 7. Streaming 更新
**實作**: pollResponse 期間用 `bot.editMessageText()` 即時更新 TG 訊息，800ms 輪詢間隔，20 字最小差異門檻避免 rate limit。

### 8. 圖片辨識（Image Recognition via Bridge）
**問題**: Telegram 傳圖片 → Bridge 下載 → 傳文字路徑給 AI → AI 觸發 `VIEW_FILE` tool call → 永遠卡在 `WAITING` 狀態。
IDE 內部直接貼圖可以正常辨識（顯示「Analyzed 📷」），但 Bridge API 走的文字路徑行不通。

**解法**: 透過分析 Language Server binary 的 protobuf 定義，發現 `SendUserCascadeMessageRequest` 有獨立的 `media` 欄位。
用 `media: [{ mimeType: "image/jpeg", inlineData: "<base64>" }]` 直接把圖片 bytes 嵌入 API payload。
AI 就像在 IDE 裡一樣直接辨識圖片，不需要任何 tool call。

```javascript
// rpc.js — sendMessage with media
payload.media = [{ mimeType: 'image/jpeg', inlineData: base64Data }];
```

**支援的 media types（已驗證）**:
- `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/bmp` — 圖片辨識
- `audio/ogg`, `audio/wav`, `audio/mpeg`, `audio/flac`, `audio/mp4`, `audio/aac` — 語音/音頻辨識
- `application/pdf` — PDF 文件讀取（比 file path + VIEW_FILE 快很多）

**已知限制**:
- `images` field (legacy `ImageData` 格式) 仍會觸發 VIEW_FILE，不要用
- 影片（video）和貼圖（sticker）尚未測試
- Telegram API 對檔案有 20MB 限制

---

## 待研究：Tool Call 授權機制

### 背景
社群有人分享了更完整的 Bridge，支援：
- 工具呼叫權限授權（Telegram inline keyboard 點按）
- MCP / Skill 支援
- YOLO mode（自動授權）

但沒分享技術細節。

### 研究方向
1. **找 tool call step type**: 非 conversational 模式下，tool call 可能需要授權
2. **找授權 API**: 可能有 `AuthorizeCascadeToolCall` 之類的 RPC method
3. **找 step status**: 等待授權時可能是特殊狀態（如 `WAITING_FOR_AUTHORIZATION`）

### 預期架構
```
User 傳訊息 → AI 回應需要 tool call
  → trajectory 出現 tool call step (status: waiting)
  → Bridge 偵測到，用 TG inline keyboard 問用戶
  → 用戶點「允許」
  → Bridge 呼叫授權 API
  → AI 繼續執行 → 回應完成
```

### YOLO Mode
如果找到授權 API，YOLO mode 就是自動呼叫授權、不問用戶。

---

## 待研究：其他 API Methods

Language Server 可能有更多 RPC methods，可以透過以下方式探索：
1. 在 Antigravity IDE 裡做各種操作，同時抓封包
2. 反編譯 Antigravity 的前端 JS 找 RPC 呼叫
3. 嘗試 Connect protocol 的 reflection（如果有啟用）

### 已知可用 Methods
- `StartCascade`
- `SendUserCascadeMessage`
- `GetCascadeTrajectory`
- `GetCommandModelConfigs`

### 可能存在的 Methods（待驗證）
- `AuthorizeCascadeToolCall` — 授權工具呼叫
- `CancelCascade` — 取消正在跑的 cascade
- `DeleteCascade` — 刪除 cascade
- `ListCascades` — 列出所有 cascade

---

## 專案結構

```
antigravity-bridge/
├── bridge.js           # 主程式入口（讀 .env, 組裝模組）
├── lib/
│   ├── detect.js       # CSRF token + port 自動偵測（Mac/Win）
│   ├── rpc.js          # Connect API RPC client（snapshot-based polling + stability fallback + system prompt）
│   └── telegram.js     # Telegram Bot（訊息佇列 + streaming + auto-reconnect + queue stuck detection）
├── debug-trajectory.mjs # 除錯工具：dump 完整 trajectory 結構
├── setup.js            # 互動式設定精靈
├── start.command        # macOS 一鍵啟動（雙擊即可）
├── package.json        # 2 個依賴：dotenv + node-telegram-bot-api
├── .env                # 設定（TOKEN, USER_ID, PROJECT_PATH, SYSTEM_PROMPT）
├── .env.example        # 設定範本
├── .gitignore
└── README.md           # 中英雙語說明
```

## .env 設定說明

```bash
TELEGRAM_BOT_TOKEN=xxx       # Telegram Bot Token（@BotFather 取得）
ALLOWED_USER_ID=xxx          # 限制只有這個 TG user 能用
PROJECT_PATH=/path/to/dir    # Antigravity IDE 開啟的專案路徑
AI_MODEL=MODEL_PLACEHOLDER_M18  # AI 模型（預設 Gemini 3 Flash）
POLL_TIMEOUT_MS=120000       # AI 回應超時（預設 120 秒）
SYSTEM_PROMPT=...            # 系統提示詞（每個新對話開頭注入）
WHISPER_MODEL=turbo          # Whisper STT 模型（預設 turbo，可選 tiny/base/small/medium/large）
```

### 9. 語音輸入 STT（Voice Input）
**問題**: 音頻資料透過 `media` field 傳送，API 接受但 Gemini 無法處理語音內容。AI 確認需要預處理。
**解法**: 本地 STT 流程：
1. 下載 Telegram 語音訊息 (OGG)
2. ffmpeg 轉換為 WAV (16kHz mono)
3. OpenAI Whisper 轉文字
4. 轉錄文字傳送給 AI

```
TG 語音 → 下載 OGG → ffmpeg → WAV → Whisper STT → 文字 → AI
```

**需求**: `whisper` (OpenAI)、`ffmpeg`
**模型**: 預設 `turbo`，透過 `WHISPER_MODEL` 環境變數設定

---

*最後更新: 2026-03-04 by Claude — v2.3 新增 Whisper 語音辨識*
