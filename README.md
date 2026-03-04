# Antigravity Bridge v2.3

透過 Telegram 與 Antigravity IDE 內建 AI 對話。
Chat with Antigravity IDE's built-in AI via Telegram.

## 架構 / Architecture

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
> 本專案需要以下前置條件才能運作：
> This project requires the following prerequisites:
>
> 1. **Antigravity IDE** — 必須已安裝，且**開啟一個專案資料夾**（只開 Launchpad 不夠，Language Server 不會啟動）
>    Must be installed and have **a project folder open** (Launchpad alone is not enough — Language Server won't start)
>
> 2. **OpenClaw** — 必須已安裝並運行（Antigravity 的 Agent 執行環境）
>    Must be installed and running (Antigravity's agent runtime)
>
> 3. **Node.js v18+** — 必須自行安裝，Bridge 的執行環境（見下方安裝說明）
>    Must be installed manually, Bridge runtime (see install instructions below)
>
> 4. **Telegram** — 手機上安裝 Telegram App，並建立一個 Bot（見下方說明）
>    Install Telegram on your phone and create a Bot (see instructions below)

---

## 能力 / Capabilities

| # | 能力 Capability | 說明 Description |
|---|----------------|-----------------|
| 1 | 📷 圖片辨識 Image Recognition | 傳圖片給 Bot，AI 直接看到並辨識 |
| 2 | 📄 PDF 閱讀 PDF Reading | 傳 PDF 給 Bot，AI 讀取內容 |
| 3 | 🎤 語音輸入 Voice Input (STT) | 傳語音訊息，自動轉文字給 AI |
| 4 | 🔊 語音輸出 Voice Output (TTS) | AI 可以用語音回覆 |
| 5 | 💻 終端指令 Terminal Commands | AI 可以執行終端指令 |
| 6 | ✏️ 檔案編輯 File Editing | AI 可以讀寫檔案 |
| 7 | 📎 檔案操作 File Handling | 傳檔案給 Bot，AI 可以讀取 |

---

## 前置條件 / Prerequisites

### 必要 Required

| 軟體 Software | 用途 Purpose | 如何安裝 How to Install |
|---------------|-------------|------------------------|
| **Antigravity IDE** | AI Language Server | [antigravity.dev](https://antigravity.dev) 下載 |
| **OpenClaw** | Agent 執行環境 | 依平台安裝 |
| **Node.js** (v18+) | 執行 Bridge | **需自行安裝**，見下方 |
| **Telegram** | 對話介面 | App Store / Google Play |

### 語音功能 Voice Features (選配 Optional)

| 軟體 Software | 用途 Purpose | 安裝方式 Install |
|---------------|-------------|-----------------|
| Python 3 (3.8+) | Whisper, edge-tts | 見下方 |
| ffmpeg | 音訊轉換 | 見下方 |
| openai-whisper | 語音辨識 STT | `pip install openai-whisper` |
| edge-tts | 語音合成 TTS | `pip install edge-tts` |

> **Note**: 語音功能是**選配**的。如果不需要語音，可跳過 Python/ffmpeg 安裝。
> Voice features are **optional**. Skip Python/ffmpeg if you don't need voice.

---

## 安裝 Node.js / Installing Node.js

Bridge **必須**有 Node.js 才能執行。如果你的系統還沒有，請先安裝：
Bridge **requires** Node.js. Install it if you don't have it:

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
# Installer 會自動加入 PATH
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

#### Python 3
```bash
# macOS（通常已內建 / usually pre-installed）
python3 --version

# 如果沒有 / If missing:
brew install python3          # macOS
# Windows: https://python.org → Download
```

#### ffmpeg
```bash
brew install ffmpeg            # macOS
sudo apt install ffmpeg        # Ubuntu/Debian
# Windows: https://ffmpeg.org/download.html
```

#### Whisper STT
```bash
# 重要：numpy 必須 < 2.0（否則 Whisper 會崩潰）
pip install "numpy<1.26"
pip install openai-whisper

# 第一次使用會下載模型（turbo ≈ 150MB）
```

#### edge-tts TTS
```bash
pip install edge-tts
```

### 檢查環境 Check Environment
```bash
./tools/check-env.sh
```

---

## 快速開始 / Quick Start

### 1. 下載專案 Clone
```bash
git clone <repo-url>
cd antigravity-bridge
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
1. 開啟 Antigravity IDE / Open Antigravity IDE
2. 開一個專案資料夾 / Open a project folder
3. 等 Language Server 啟動 / Wait for Language Server

### 5. 啟動 Bridge
```bash
npm start
```

**macOS 一鍵啟動**: 雙擊 `start.command`（自動啟動 IDE + Bridge）
**Windows**: 雙擊 `start.bat`

### 6. 開始聊天！
在 Telegram 找你的 Bot，傳訊息就好了！

---

## 如何取得 Telegram Bot Token

1. 打開 Telegram → 搜尋 **@BotFather**
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

## Telegram 指令 / Bot Commands

| 指令 Command | 說明 Description |
|-------------|-----------------|
| `/start` | 顯示說明 Help |
| `/status` | 連線狀態 Connection status |
| `/newchat` | 新對話 New conversation |
| `/reconnect` | 重新偵測 LS Re-detect |
| `/yolo` | 自動核准 Auto-approve AI actions |
| `/safe` | 恢復安全模式 Restore safe mode |

---

## 設定參數 / Configuration

| 變數 Variable | 必填 | 說明 Description |
|---------------|------|-----------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | 從 @BotFather 取得 |
| `ALLOWED_USER_ID` | — | 限制只有你能用 Bot |
| `PROJECT_PATH` | — | 啟動時自動開專案 |
| `AI_MODEL` | — | 預設 MODEL_PLACEHOLDER_M18 |
| `POLL_TIMEOUT_MS` | — | 回應超時 (預設 120000ms) |
| `WHISPER_MODEL` | — | STT 模型 (預設 turbo) |
| `SYSTEM_PROMPT` | — | AI 系統提示詞 |

---

## 工具集 / Tools

`tools/` 目錄包含輔助工具：

| 工具 Tool | 說明 Description |
|-----------|-----------------|
| `tts.sh` | Shell 語音合成 |
| `stt.sh` | Shell 語音辨識 |
| `voice_tts.py` | Python TTS（支援分段、Markdown 清洗）|
| `voice_stt.py` | Python STT（自動安裝 Whisper）|
| `convert-audio.sh` | 音訊格式轉換 |
| `check-env.sh` | 檢查環境是否完備 |
| `install-deps.sh` | 一鍵安裝所有語音依賴 |

---

## 專案結構 / Project Structure

```
antigravity-bridge/
├── bridge.js           # 主程式 Main entry
├── lib/
│   ├── detect.js       # 自動偵測 CSRF + port
│   ├── rpc.js          # Connect API calls
│   └── telegram.js     # Telegram Bot handler
├── tools/              # 工具腳本 Utility scripts
├── setup.js            # 設定精靈 Setup wizard
├── start.command       # macOS one-click
├── start.bat           # Windows one-click
├── package.json
├── .env.example        # 設定範本 Config template
└── README.md
```

---

## 缺少什麼？如何補齊 / Troubleshooting

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
| 回應太慢超時 | 增加 .env 中 `POLL_TIMEOUT_MS`（預設 120 秒）|
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
| Linux | ✅ 應可運行 |
| Windows | ✅ 支援（PowerShell 偵測）|

## License

MIT
