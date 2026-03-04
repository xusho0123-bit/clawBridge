# Tools 工具集

Antigravity Bridge 能力所需的工具腳本。
Tool scripts for Antigravity Bridge capabilities.

## 工具列表 / Tool List

### Shell 腳本

| Tool 工具 | Description 說明 | Usage 用法 |
|-----------|-----------------|------------|
| `tts.sh` | 語音合成 TTS | `./tools/tts.sh "你好" /tmp/hello.mp3` |
| `stt.sh` | 語音辨識 STT | `./tools/stt.sh /tmp/audio.ogg` |
| `convert-audio.sh` | 音訊轉換 | `./tools/convert-audio.sh input.ogg output.wav` |
| `check-env.sh` | 環境檢查 | `./tools/check-env.sh` |
| `install-deps.sh` | 安裝依賴 | `./tools/install-deps.sh` |

### Python 工具

| Tool 工具 | Description 說明 | Usage 用法 |
|-----------|-----------------|------------|
| `voice_tts.py` | TTS（分段、Markdown 清洗）| `python3 tools/voice_tts.py -t "你好"` |
| `voice_stt.py` | STT（自動安裝 Whisper）| `python3 tools/voice_stt.py audio.ogg` |

## 快速開始 / Quick Start

```bash
# 1. 檢查環境 Check environment
./tools/check-env.sh

# 2. 安裝缺少的依賴 Install missing deps
./tools/install-deps.sh

# 3. 測試 TTS Test TTS
./tools/tts.sh "測試語音" /tmp/test.mp3
# or
python3 tools/voice_tts.py -t "測試語音" -o /tmp/test.mp3

# 4. 測試 STT Test STT
./tools/stt.sh /tmp/test_audio.ogg
# or
python3 tools/voice_stt.py /tmp/test_audio.ogg
```

## 依賴安裝 / Dependencies

### 必要 Required (for Bridge)

| 軟體 | 安裝方式 |
|------|---------|
| Node.js 18+ | `brew install node` 或 [nodejs.org](https://nodejs.org) |

### 語音功能 Voice Features (選配 Optional)

| 軟體 | 安裝方式 |
|------|---------|
| Python 3.8+ | `brew install python3` 或 [python.org](https://python.org) |
| ffmpeg | `brew install ffmpeg` (macOS) / `apt install ffmpeg` (Linux) |
| openai-whisper | `pip install openai-whisper` |
| edge-tts | `pip install edge-tts` |
| numpy <2.0 | `pip install "numpy<1.26"` (Whisper 相容性需求) |

### 一鍵安裝所有語音依賴

```bash
./tools/install-deps.sh
```

## AI 如何使用這些工具 / How AI Uses These

Bridge 中的 AI（Antigravity IDE 內建模型）透過終端指令使用工具：

### TTS 語音回覆
AI 執行 TTS 指令後，在回覆中包含路徑：
```
MEDIA: /tmp/response.mp3
asVoice: true
```
Bridge 偵測到 `MEDIA:` 標籤就會把音檔傳到 Telegram。

### STT 語音輸入
Bridge 自動處理：
```
收到語音 → ffmpeg 轉 WAV (16kHz mono) → Whisper 辨識 → 文字傳給 AI
```
AI 收到的是已轉好的文字，前面會加 `[語音訊息內容]` 標記。

### 圖片 / PDF
Bridge 自動透過 Connect API 的 `media` 欄位傳給 AI（base64 inline）。
AI 可以直接「看到」圖片和「讀到」PDF 內容。

## OpenClaw 工具生態 / OpenClaw Tools

如果你也使用 OpenClaw，以下 docs/tools 中的工具可搭配使用：

| 工具 | 說明 | 位置 |
|------|------|------|
| `telegram-offline-voice` | Docker 容器版 TTS | `docs/tools/telegram-offline-voice/` |
| `telegram-upload` | 上傳檔案到 TG | `docs/tools/telegram-upload/` |
| `ffmpeg` | ffmpeg 二進位 + presets | `docs/tools/ffmpeg/` |

這些工具設計為在 OpenClaw Docker 環境中執行。
本專案的 `tools/` 目錄提供的是**本地版本**，不需要 Docker。
