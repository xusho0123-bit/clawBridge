# Antigravity Bridge v3.2

透過 Telegram 遠端操控 Antigravity IDE 內建 AI。
Remotely control Antigravity IDE's built-in AI via Telegram.

```
你的手機 / Your Phone
    ↕  Telegram Bot API
Antigravity Bridge (本專案 / this project)
    ↕  Connect Protocol (HTTPS/JSON, localhost)
Antigravity IDE Language Server
    ↕
AI Model (cloud)
```

Bridge 自動偵測 Language Server 的 CSRF token 和 port。
不需要額外的 API key，不需要瀏覽器自動化。

---

> **安裝前請確認 / Before You Start**
>
> 1. **Antigravity IDE** — 必須已安裝，且**開啟一個專案資料夾**（只開 Launchpad 不夠，Language Server 不會啟動）
>    Must be installed with **a project folder open** (Launchpad alone won't start Language Server)
>
> 2. **OpenClaw** — AI 的 Agent 執行環境（讓 AI 能執行指令、編輯檔案）
>    Agent runtime for AI tool calls (terminal commands, file editing)
>
> 3. **Node.js v18+** — Bridge 的執行環境（見下方安裝說明）
>    Bridge runtime (see install instructions below)
>
> 4. **Telegram** — 手機上安裝 Telegram App，並建立一個 Bot（見下方說明）
>    Install Telegram on your phone and create a Bot (see instructions below)

---

## 能力 / Capabilities

| # | 能力 Capability | 說明 Description |
|---|----------------|-----------------|
| 1 | 📷 圖片辨識 Image Recognition | 傳圖片給 Bot，AI 直接看到並辨識 |
| 2 | 📄 PDF 閱讀 PDF Reading | 傳 PDF 給 Bot，AI 讀取內容 |
| 3 | 🎤 語音輸入 Voice Input (STT) | 傳語音訊息，Whisper 自動轉文字給 AI |
| 4 | 🔊 語音輸出 Voice Output (TTS) | AI 可以用語音回覆（需 edge-tts） |
| 5 | 💻 終端指令 Terminal Commands | AI 可以執行終端指令 |
| 6 | ✏️ 檔案編輯 File Editing | AI 可以讀寫檔案 |
| 7 | 📎 檔案操作 File Handling | 傳檔案給 Bot，AI 可以讀取 |
| 8 | 🧠 長期記憶 Memory System | 釘選 + 筆記 + 歷史搜尋，AI 有記憶了 |
| 9 | ⏰ 排程功能 Scheduled Messages | 每日定時發送訊息給 AI |
| 10 | 🔐 遠端權限控制 Remote Approve | 從 TG 控制 IDE 自動核准設定 |

---

## 快速開始 / Quick Start

### 1. 下載專案 Clone
```bash
git clone https://github.com/xusho0123-bit/clawBridge.git
cd clawBridge
```

### 2. 安裝依賴 Install
```bash
npm install
```

### 3. 設定 Configure

**互動式精靈（推薦）Setup Wizard:**
```bash
npm run setup
```

**或手動 Or manually:**
```bash
cp .env.example .env
# 編輯 .env，至少填入 TELEGRAM_BOT_TOKEN
# Edit .env, fill in TELEGRAM_BOT_TOKEN at minimum
```

### 4. 啟動 Antigravity IDE
1. 開啟 Antigravity IDE
2. 開一個專案資料夾（不能只開 Launchpad）
3. 等 Language Server 啟動

### 5. 啟動 Bridge
```bash
npm start
```

**macOS 一鍵啟動**: 雙擊 `start.command`
**Windows**: 雙擊 `start.bat`（自動偵測 Node.js 路徑）

### 6. 開始聊天！
在 Telegram 找你的 Bot，傳訊息就好了！

---

## 前置條件 / Prerequisites

### 必要 Required

| 軟體 Software | 用途 Purpose | 如何安裝 How to Install |
|---------------|-------------|------------------------|
| **Antigravity IDE** | AI Language Server | [antigravity.dev](https://antigravity.dev) 下載 |
| **OpenClaw** | Agent 執行環境（AI 工具呼叫） | 依平台安裝 |
| **Node.js** (v18+) | 執行 Bridge | 見下方 |
| **Telegram** | 對話介面 | App Store / Google Play |

### 語音功能 Voice Features (選配 Optional)

| 軟體 Software | 用途 Purpose | 安裝方式 Install |
|---------------|-------------|-----------------|
| Python 3 (3.8+) | Whisper, edge-tts | 見下方 |
| ffmpeg | 音訊轉換 | 見下方 |
| openai-whisper | 語音辨識 STT | `pip install openai-whisper` |
| edge-tts | 語音合成 TTS | `pip install edge-tts` |

> **Note**: 語音功能是**選配**的。如果不需要語音，可跳過 Python/ffmpeg 安裝。

---

## 安裝 Node.js / Installing Node.js

### macOS
```bash
# 方法 1: Homebrew（推薦 Recommended）
brew install node

# 方法 2: 官網下載 / Official website
# https://nodejs.org → Download LTS → Run installer
```

### Windows
```
# 官網下載 / Download from:
# https://nodejs.org → Download LTS → Run installer
# start.bat 會自動搜尋常見安裝路徑
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update && sudo apt install nodejs npm
```

### 驗證 / Verify
```bash
node --version    # 應顯示 v18+ / Should show v18+
npm --version     # 應顯示 8+
```

---

## 安裝語音依賴 / Installing Voice Dependencies

### 一鍵安裝 One-click Install
```bash
./tools/install-deps.sh
```

### 手動安裝 Manual Install

```bash
# ffmpeg
brew install ffmpeg            # macOS
sudo apt install ffmpeg        # Ubuntu/Debian

# Whisper STT
pip install "numpy<1.26"
pip install openai-whisper

# edge-tts TTS
pip install edge-tts
```

### 檢查環境 Check Environment
```bash
./tools/check-env.sh
```

---

## Telegram 指令 / Bot Commands

### 基本指令

| 指令 Command | 說明 Description |
|-------------|-----------------|
| `/start` `/help` | 顯示說明 Help |
| `/status` | 連線狀態 + 記憶統計 |
| `/newchat` | 新對話 New conversation |
| `/reconnect` | 重新偵測 LS Re-detect |
| `/model` | 切換 AI 模型 Switch model |
| `/cancel` | 即時取消 AI Cancel AI (v3.0) |
| `/cascades` | 列出/刪除舊對話 Manage cascades |

### 記憶系統 Memory System

| 指令 Command | 說明 Description |
|-------------|-----------------|
| `/pin` | 列出所有釘選 |
| `/pin add 文字` | 新增釘選（每次對話都注入 AI） |
| `/pin remove <id>` | 刪除釘選 |
| `/pin clear` | 清除所有釘選 |
| `/note` | 列出所有筆記 |
| `/note add [tag1,tag2] 內容` | 新增筆記（關鍵字自動匹配） |
| `/note remove <id>` | 刪除筆記 |
| `/note search 關鍵字` | 搜尋筆記 |
| `/recall 關鍵字` | 搜尋歷史對話 |
| `/memory` | 記憶總覽 |

### 排程功能

| 指令 Command | 說明 Description |
|-------------|-----------------|
| `/schedule` | 查看排程列表 |
| `/schedule add HH:MM 訊息` | 新增每日排程 |
| `/schedule remove <id>` | 刪除排程 |

### 權限控制

| 指令 Command | 說明 Description |
|-------------|-----------------|
| `/yolo` | 全部自動核准（AI 完全自主） |
| `/safe` | 恢復安全模式 |
| `/approve` | 查看目前權限設定 |
| `/approve <type> <on\|off>` | 個別控制 (edits/terminal/urls/all) |

---

## 記憶系統 / Memory System

三層記憶系統，讓 AI 有長期記憶：

### Layer 1: 📌 釘選 (Pins)
- **用途**: 常駐背景知識（你住哪、偏好、規則等）
- **注入**: 每次新對話都會自動帶給 AI
- **限制**: 最多 10 條，每條 200 字
- **檔案**: `data/pins.json`

### Layer 2: 📝 筆記 (Notes)
- **用途**: 知識庫（帶標籤，AI 或你都能存）
- **注入**: 根據訊息關鍵字自動匹配，最多帶 3 條相關筆記
- **限制**: 最多 50 條，每條 500 字
- **檔案**: `data/notes.json`
- **CJK 支援**: 中文 N-gram 關鍵字匹配

### Layer 3: 🔍 歷史回顧 (Recall)
- **用途**: 搜尋過去對話
- **注入**: 只在 `/recall` 或 AI 主動 `RECALL:` 時才觸發
- **檔案**: 現有 `data/history.json`

### AI 自動記憶
AI 回覆中可以使用特殊標記：
- `REMEMBER: [標籤1,標籤2] 要記住的內容` — 自動存為筆記
- `RECALL: 關鍵字` — 搜尋歷史對話

---

## 設定參數 / Configuration

| 變數 Variable | 必填 | 說明 Description |
|---------------|------|-----------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | 從 @BotFather 取得 |
| `ALLOWED_USER_ID` | — | 限制誰能用 Bot（逗號分隔多人） |
| `PROJECT_PATH` | — | 啟動時自動開專案 |
| `AI_MODEL` | — | 預設 MODEL_PLACEHOLDER_M18 |
| `POLL_TIMEOUT_MS` | — | 回應超時 (預設 120000ms) |
| `WHISPER_MODEL` | — | STT 模型 (預設 turbo) |
| `WHISPER_LANGUAGE` | — | Whisper 語言代碼（如 `zh`），不設自動偵測 |
| `SYSTEM_PROMPT` | — | AI 系統提示詞（含記憶功能說明） |

---

## 如何取得 Telegram Bot Token

1. 打開 Telegram, 搜尋 **@BotFather**
2. 傳送 `/newbot`
3. 按指示命名（例如 `MyAIBridge`）
4. BotFather 會給你 token（格式：`123456789:ABCdef...`）
5. 貼到 `.env` 的 `TELEGRAM_BOT_TOKEN=` 後面

## 如何取得 User ID

1. 在 Telegram 搜尋 **@userinfobot**
2. 傳任何訊息給它
3. 它會回覆你的 ID（一串數字）
4. 填入 `.env` 的 `ALLOWED_USER_ID=`

---

## 專案結構 / Project Structure

```
antigravity-bridge/
├── bridge.js              # 主程式 Main entry (75 行)
├── lib/
│   ├── rpc.js             # Connect Protocol RPC client (922 行) ⭐
│   ├── telegram/          # Telegram Bot — 8 模組 (1390 行) ⭐
│   │   ├── index.js       # 入口 + message handler + scheduler
│   │   ├── ctx.js         # 共享 context 物件
│   │   ├── settings.js    # IDE 設定讀寫
│   │   ├── media.js       # MIME/下載/STT
│   │   ├── queue.js       # 訊息佇列 + AI 互動
│   │   ├── commands.js    # 所有 /指令
│   │   ├── callbacks.js   # Inline button callback
│   │   └── watchdog.js    # 健康檢查 + 自適應重連
│   ├── detect.js          # 自動偵測 CSRF + port (Mac/Win)
│   ├── memory.js          # 三層記憶系統
│   ├── history.js         # 對話持久化
│   └── scheduler.js       # 排程功能
├── data/                  # 執行時資料（自動建立）
│   ├── session.json       # cascade 狀態
│   ├── history.json       # 對話紀錄 (max 200)
│   ├── pins.json          # 釘選
│   └── notes.json         # 筆記
├── tools/                 # 工具腳本 Utility scripts
├── docs/                  # 研究記錄 Research notes
├── setup.js               # 設定精靈 Setup wizard
├── start.command           # macOS one-click
├── start.bat              # Windows one-click (Node.js 自動偵測)
├── package.json           # 2 個依賴：dotenv + node-telegram-bot-api
├── .env.example           # 設定範本 Config template
├── SPEC.md                # 專案規格書
└── README.md
```

**總行數 / Total**: ~2,956 行

---

## v3.2 更新 / What's New

### StreamAgentStateUpdates 串流突破
- 🚀 **全新串流 API** — 逆向 LS binary 發現 `StreamAgentStateUpdates`，取代被禁用的 `StreamCascadeReactiveUpdates`
- ⚡ **回應延遲 < 0.5 秒**（polling 約 3 秒）
- 🧠 **thinking 即時顯示** — AI 思考過程可見
- 📊 **Token 用量追蹤** — 串流內直接取得

### v3.0 穩定性改善 Stability (v3.0)
- 🛡 **串流超時保護**: 30 秒無資料自動斷流，保留已收到的文字
- ⛔ **即時取消**: `/cancel` 秒斷串流和輪詢（AbortController）
- 🔄 **快速重連**: 斷線後 5 秒重試（前 2 分鐘），之後 30 秒
- 📝 **部分文字保留**: 超時不再丟棄，加 `⚠ *回應可能不完整*` 提示
- 🔧 **5 項 Bug 全修** — 權限攔截、streaming 恢復、timeout、replay、重複回應

### 模組化重構 Modular Refactor
- 原本 1365 行的 `telegram.js` 拆分為 8 個模組
- 共享 context 物件模式，更易維護和擴展
- 每個模組職責單一、可獨立測試

---

## Troubleshooting

| 問題 Issue | 解決方式 Solution |
|-----------|------------------|
| 沒有 Node.js | `brew install node` 或到 [nodejs.org](https://nodejs.org) 下載 |
| 沒有 Telegram Bot Token | 找 @BotFather 建立，token 填入 .env |
| Language Server 找不到 | 確認 Antigravity 有**開啟專案**，不只是 Launchpad |
| 語音辨識不能用 | `./tools/install-deps.sh` 或 `pip install openai-whisper` |
| 語音合成不能用 | `pip install edge-tts` |
| ffmpeg 找不到 | `brew install ffmpeg` (macOS) / `apt install ffmpeg` |
| numpy 版本衝突 | `pip install "numpy<1.26"` |
| AI 沒回應 | `/reconnect` 重連；確認沒有其他 Bridge 在跑 |
| AI 回覆到一半卡住 | v3.0 已修復：30 秒自動斷流 + 保留部分文字 |
| /cancel 沒反應 | v3.0 已修復：AbortController 即時取消 |
| 回應太慢超時 | 增加 .env 中 `POLL_TIMEOUT_MS`（預設 120 秒）|
| 串流不是即時的 | v3.2 使用 StreamAgentStateUpdates，回應 < 0.5 秒 |
| 權限按鈕沒出現 | 確認 `/safe` 模式；v3.2 串流內直接偵測 WAITING |
| 其他 Bridge 衝突 | `pkill -f 'node bridge'` 然後重啟 |

---

## 背景執行 / Background Mode

```bash
nohup node bridge.js > bridge.log 2>&1 &
```

## 平台 / Platform Support

| 平台 | 狀態 |
|------|------|
| macOS | ✅ 完整測試 |
| Windows | ✅ 支援（PowerShell 偵測 + Node.js 自動搜尋） |
| Linux | ✅ 應可運行 |

## License

MIT
