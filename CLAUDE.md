# ClawBridge — AI 助手指南

> 這份文件是給 AI 助手（你）看的，幫助你理解這個專案並協助老闆操作。

## 這個專案是什麼

ClawBridge（又名 Antigravity Bridge）是一個 Node.js 程式，讓老闆可以用手機 Telegram 跟你（Antigravity IDE 的 AI）對話。

```
手機 Telegram App
    ↕ Telegram Bot API（網路）
ClawBridge（這個專案，跑在本機）
    ↕ Connect Protocol（localhost）
你（Antigravity IDE Language Server）
```

簡單說：**你就是 AI，這個程式是讓老闆用手機控制你的橋樑。**

## 重要檔案

| 檔案 | 作用 |
|------|------|
| `bridge.js` | 主程式入口 |
| `lib/telegram.js` | Telegram Bot 處理（指令、訊息、媒體） |
| `lib/rpc.js` | 跟你（Language Server）溝通的 API |
| `lib/detect.js` | 自動偵測 CSRF token 和 port |
| `lib/memory.js` | 三層記憶系統（釘選、筆記、歷史） |
| `lib/history.js` | 對話紀錄存檔 |
| `.env` | 設定檔（Bot Token、模型等）**不可分享** |
| `.env.example` | 設定檔範本 |
| `data/models.json` | AI 模型 ID 對照表 |
| `data/session.json` | 目前的 cascade 狀態 |
| `data/history.json` | 對話紀錄 |

## 如何安裝（全新電腦）

### 前置條件
1. **Node.js v18+** — 到 https://nodejs.org 下載 LTS 版
2. **Git** — 到 https://git-scm.com 下載
3. **Antigravity IDE** — 必須開啟並打開一個專案資料夾
4. **Telegram Bot Token** — 找 @BotFather 建立

### 安裝步驟
```bash
# 1. 下載專案
git clone https://github.com/xusho0123-bit/clawBridge.git
cd clawBridge

# 2. 安裝依賴
npm install

# 3. 建立設定檔
cp .env.example .env

# 4. 編輯 .env，填入：
#    TELEGRAM_BOT_TOKEN=你的token
#    ALLOWED_USER_ID=你的TG用戶ID
#    PROJECT_PATH=你的專案路徑
#    AI_MODEL=MODEL_GOOGLE_GEMINI_2_5_PRO

# 5. 啟動
node bridge.js
```

### 啟動/重啟腳本

| 腳本 | Mac | Windows | 功能 |
|------|-----|---------|------|
| **start** | `start.command` | `start.bat` | 只重啟 Bridge（殺舊 Bridge → 清 session → 重新偵測 port → 啟動） |
| **restart** | `restart.command` | `restart.bat` | 重啟全部三個服務（OpenClaw + Antigravity + Bridge） |
| **pc-update** | — | `scripts/pc-update.bat` | 全新安裝或 git pull 更新 |

- 遇到 timeout 或小問題 → 用 **start**
- 整個卡死、port 全亂 → 用 **restart**
- 有新版本要更新 → 用 **pc-update**（或 `git pull`）

## 如何更新

```bash
cd clawBridge
git pull
npm install
# 重啟 bridge 即可
```

或在 Windows 直接雙擊 `pc-update.bat`。

## .env 設定說明

```ini
# 必填
TELEGRAM_BOT_TOKEN=從@BotFather取得的token

# 建議填
ALLOWED_USER_ID=老闆的Telegram用戶ID（限制只有老闆能用）
AI_MODEL=MODEL_GOOGLE_GEMINI_2_5_PRO

# 選填
PROJECT_PATH=/path/to/project
POLL_TIMEOUT_MS=120000
WHISPER_MODEL=turbo
SYSTEM_PROMPT=（見 .env.example 的範本）
```

## 可用的 AI 模型

見 `data/models.json`，目前支援：

| 按鈕名稱 | Model ID | 說明 |
|----------|----------|------|
| Gemini 3.1 Pro | MODEL_GOOGLE_GEMINI_2_5_PRO | 高品質，推薦 |
| Gemini 3.1 Pro (Low) | MODEL_GOOGLE_GEMINI_2_5_PRO_LOW | 省額度 |
| Gemini 3 Flash | MODEL_PLACEHOLDER_M18 | 快但品質低 |
| Claude Sonnet 4.6 | MODEL_CLAUDE_4_SONNET_THINKING | |
| Claude Opus 4.6 | MODEL_CLAUDE_4_OPUS_THINKING | 最強但最慢 |
| GPT-OSS 120B | MODEL_OPENAI_GPT_OSS_120B_MEDIUM | |

## Telegram Bot 指令

使用者在 Telegram 可以用這些指令：

| 指令 | 功能 |
|------|------|
| `/help` 或 `/?` | 顯示說明 |
| `/newchat` | 開新對話 |
| `/model` | 切換 AI 模型（按鈕選單） |
| `/status` | 查看連線狀態 |
| `/cancel` | 取消 AI 執行 |
| `/pin add 文字` | 釘選（每次對話都注入你） |
| `/note add [標籤] 內容` | 存筆記 |
| `/recall 關鍵字` | 搜尋歷史對話 |
| `/yolo` | 全自動核准模式 |
| `/safe` | 恢復安全模式 |

## 常見問題排解

| 問題 | 解法 |
|------|------|
| `Error: AI response timeout` | Google 伺服器塞車，等一下再試或用 `/model` 換模型 |
| `trajectory not found` | cascade 已過期，傳新訊息會自動建新的 |
| `CSRF token not found` | Antigravity IDE 沒開，或沒開專案資料夾 |
| `409 Conflict` | 有兩個 Bridge 同時在跑，關掉一個 |
| `Language Server 找不到` | 確認 Antigravity IDE 有開啟專案（不只是 Launchpad） |
| AI 每次回覆都重複之前的內容 | 見下方「AI 回覆重複問題」 |

### AI 回覆重複問題

**症狀**: AI 每次回覆都把之前的對話內容重新說一遍，越來越長。

**原因**: cascade（對話歷史）累積太多，AI 看到完整歷史就自動回顧。

**解法（依序嘗試）**:

1. **更新 `.env` 的 SYSTEM_PROMPT**（最重要）— 確認有這兩條規則：
   ```
   4. 絕對不要重複之前的對話內容。不要回顧、不要列出之前做了什麼。只回答當前的問題
   5. 每次回覆控制在 500 字以內，除非使用者要求詳細說明
   ```
   完整 SYSTEM_PROMPT 請從 `.env.example` 複製。

2. **開新對話** — 在 TG 傳 `/newchat`，或重啟 Bridge（`start.bat`）清除舊 cascade

3. **換模型** — Gemini Flash 最容易重複，用 `/model` 切到 Claude Sonnet 會好很多

## ⛔ 不可以改的東西（AI 請注意）

你（AI 助手）在協助老闆維護這個專案時，**絕對不可以**做以下事情：

### 1. 不可以改 rpc.js 的模型傳送格式
```javascript
// ✅ 正確格式（不要改）
requestedModel: { model }

// ❌ 錯誤：不要拆成 provider + name
requestedModel: { provider: "google", name: "gemini-2.5-pro" }
```
模型 ID 是 Antigravity IDE 內部的 enum 值，直接傳就好，不需要解析。

### 2. 不可以自己編造模型 ID
只能用 `data/models.json` 裡列出的 ID，例如：
- `MODEL_GOOGLE_GEMINI_2_5_PRO` ✅
- `MODEL_PLACEHOLDER_M18` ✅
- `moonshot/moonshotai/kimi-k2.5` ❌（不存在）
- `gemini-2.5-pro` ❌（格式錯誤）

### 3. 不可以改 .env 裡的 AI_MODEL 為不存在的值
改之前先查 `data/models.json` 確認 ID 存在。

### 4. 不可以改 Connect Protocol 的 API 路徑和格式
所有 API endpoint 都是固定的（見 rpc.js），不要猜測或「升級」。

### 5. 不可以刪除或重寫核心檔案
`bridge.js`、`lib/rpc.js`、`lib/detect.js` 是核心，修改前必須確認原因。

**如果遇到 API 錯誤，先查 bridge.log，不要猜測原因然後亂改程式碼。**

## 開發規則（從 Bug 中學到的教訓）

> 這些規則是踩坑後的血淚經驗，開發和 code review 時必須遵守。

### 規則 1：Fallback 路徑必須有同等核心功能

**背景**: Streaming fallback 到 polling 時，`onPermission` callback 沒有傳入 polling，導致權限攔截完全失效。

**規則**:
- 當系統有 A 路徑（主要）和 B 路徑（fallback）時，**B 必須覆蓋 A 的所有 critical features**
- Fallback 不是「能動就好」，是「核心功能都要在」
- 新增 fallback 路徑時，列出所有 critical features，逐一確認都有處理
- 特別注意：callback / handler 傳入主路徑後，fallback 路徑有沒有也接收

```
✅ streaming: onUpdate ✓  onPermission ✓
❌ polling:   onUpdate ✓  onPermission ✗  ← 漏了！
```

### 規則 2：降級 Flag 必須有恢復機制

**背景**: `useStreaming = false` 一設就永久，一次網路閃斷就永遠喪失 streaming 能力。

**規則**:
- 任何把系統切到降級模式的 flag，都**必須有明確的恢復路徑**
- 不可以有「一次失敗就永久殘廢」的設計
- 每個降級 flag 要搭配：
  - **作用範圍限制**（per-cascade、per-session，不是全域永久）
  - **重試機制**（定時重試或事件觸發重試）
  - **恢復條件**（明確定義何時回到正常模式）

```javascript
// ❌ 永久降級
useStreaming = false; // 永遠不會回來

// ✅ 有恢復機制
useStreaming = false;
streamRetryCount++;
if (streamRetryCount < MAX_RETRIES) useStreaming = true; // 下次重試
// 或：resetCascade() 時自動恢復
```

### 規則 3：Timeout 必須區分「等機器」和「等人」

**背景**: 120 秒 timeout 對 AI 運算合理，但用戶從看到 Telegram 通知到按下 Allow 可能需要更長時間。

**規則**:
- Timeout 要區分兩種模式：
  - **等 AI 回應**: 正常 timeout（如 120s）
  - **等人類操作**: 大幅延長或暫停 timeout
- 當偵測到系統在等人類回應（如權限按鈕已發出），應暫停計時或切換到更長的 timeout
- 不可以用機器的速度來要求人的速度

### 規則 4：Critical Callback 要確認有被觸發

**背景**: `onPermission` 被傳入 `sendToAI()`，但 polling 路徑完全忽略它，無聲無息。

**規則**:
- 傳入 callback ≠ callback 會被調用
- Critical callback 要有「未觸發」的告警或 fallback 機制
- 新增程式路徑時，檢查所有接收到的 callback 是否都有被處理
- 特別注意 try-catch 裡的替代路徑

### 規則 5：Replay / 歷史重播要記錄被跳過的 Critical 事件

**背景**: Stream replay 時跳過的 WAITING permission，之後不會再觸發，導致權限被永久漏掉。

**規則**:
- Replay 階段跳過的事件，如果是 critical 的（如權限請求），要**記錄下來**
- Replay 結束後（切換到 live 模式時），重新檢查被跳過的 critical 事件是否仍然 pending
- 不可以假設「跳過的事件之後會重新觸發」— 如果狀態沒變，diff-based stream 不會重送

### 規則 6：測試必須覆蓋 Degraded Mode

**規則**:
- 不只測正常路徑，也要測降級 / fallback 路徑
- 測試矩陣應包含所有路徑組合：

```
✅ Streaming + 文字回覆
✅ Streaming + 權限請求
❌ Polling + 權限請求  ← 從未測試 → Bug 潛伏
```

---

## 架構概念

- **Cascade**: 一次對話（包含多輪來回），每個 cascade 有唯一 ID
- **Connect Protocol**: Antigravity 內部的 RPC 協定，用 HTTPS + JSON
- **CSRF Token**: 安全驗證，Bridge 自動從 IDE 設定檔讀取
- **Streaming**: 即時串流 AI 回覆，TG 端可以看到打字中效果
- **Memory System**: 三層記憶（Pins 常駐 / Notes 關鍵字匹配 / Recall 歷史搜尋）

## GitHub Repo

- **URL**: https://github.com/xusho0123-bit/clawBridge
- **公開 repo**，任何電腦直接 clone 不用登入
- Mac 端修改 → commit → push，PC 端 git pull 即可同步
