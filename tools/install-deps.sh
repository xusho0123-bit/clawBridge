#!/bin/bash
# ============================================================
#  安裝所有 Bridge 能力所需的依賴
#  Install all dependencies for Antigravity Bridge capabilities
#
#  Usage: ./tools/install-deps.sh
#
#  Installs:
#    - ffmpeg        (audio conversion 音訊轉換)
#    - openai-whisper (STT 語音辨識)
#    - edge-tts      (TTS 語音合成)
#    - numpy<1.26    (whisper compatibility)
# ============================================================

set -e

echo "=== Antigravity Bridge - 安裝依賴 / Install Dependencies ==="
echo ""

# Detect OS
OS="$(uname -s)"
echo "System: $OS"
echo ""

# --- ffmpeg ---
echo "--- ffmpeg (音訊轉換 / audio conversion) ---"
if command -v ffmpeg &>/dev/null; then
    echo "  [OK] ffmpeg already installed: $(ffmpeg -version 2>/dev/null | head -1)"
else
    echo "  [INSTALL] Installing ffmpeg..."
    if [ "$OS" = "Darwin" ]; then
        if command -v brew &>/dev/null; then
            brew install ffmpeg
        else
            echo "  [ERROR] Homebrew not found. Install: https://brew.sh"
            echo "  Then run: brew install ffmpeg"
        fi
    elif [ "$OS" = "Linux" ]; then
        if command -v apt-get &>/dev/null; then
            sudo apt-get update && sudo apt-get install -y ffmpeg
        elif command -v dnf &>/dev/null; then
            sudo dnf install -y ffmpeg
        fi
    else
        echo "  [ERROR] Please install ffmpeg manually: https://ffmpeg.org/download.html"
    fi
fi
echo ""

# --- Python check ---
echo "--- Python ---"
PYTHON=""
if command -v python3 &>/dev/null; then
    PYTHON="python3"
elif command -v python &>/dev/null; then
    PYTHON="python"
fi

if [ -z "$PYTHON" ]; then
    echo "  [ERROR] Python not found. Install Python 3.8+: https://python.org"
    exit 1
fi

PY_VERSION=$($PYTHON --version 2>&1)
echo "  [OK] $PY_VERSION"
echo ""

# --- pip ---
echo "--- pip ---"
if ! $PYTHON -m pip --version &>/dev/null; then
    echo "  [INSTALL] Installing pip..."
    $PYTHON -m ensurepip --upgrade 2>/dev/null || {
        echo "  [ERROR] Cannot install pip. Try: $PYTHON -m ensurepip"
        exit 1
    }
fi
echo "  [OK] $($PYTHON -m pip --version 2>&1 | head -1)"
echo ""

# --- numpy (must be <2 for whisper) ---
echo "--- numpy (whisper 相容版本 / compatible version) ---"
NUMPY_VER=$($PYTHON -c "import numpy; print(numpy.__version__)" 2>/dev/null)
if [ $? -eq 0 ]; then
    NUMPY_MAJOR=$(echo "$NUMPY_VER" | cut -d. -f1)
    if [ "$NUMPY_MAJOR" -ge 2 ]; then
        echo "  [WARN] numpy $NUMPY_VER detected (need <2.0)"
        echo "  [INSTALL] Downgrading numpy..."
        $PYTHON -m pip install "numpy<1.26" --quiet
    else
        echo "  [OK] numpy $NUMPY_VER"
    fi
else
    echo "  [INSTALL] Installing numpy..."
    $PYTHON -m pip install "numpy<1.26" --quiet
fi
echo ""

# --- openai-whisper ---
echo "--- openai-whisper (語音辨識 / STT) ---"
if command -v whisper &>/dev/null; then
    echo "  [OK] whisper already installed"
    $PYTHON -c "import whisper; print(f'  Version: {whisper.__version__}')" 2>/dev/null
else
    echo "  [INSTALL] Installing openai-whisper..."
    $PYTHON -m pip install openai-whisper --quiet
    echo "  [NOTE] First run will download the model (~150MB for turbo)"
fi
echo ""

# --- edge-tts ---
echo "--- edge-tts (語音合成 / TTS) ---"
if command -v edge-tts &>/dev/null; then
    echo "  [OK] edge-tts already installed: $(edge-tts --version 2>/dev/null)"
else
    echo "  [INSTALL] Installing edge-tts..."
    $PYTHON -m pip install edge-tts --quiet
fi
echo ""

# --- Summary ---
echo "=== 安裝結果 / Installation Summary ==="
echo ""
printf "  %-20s %s\n" "ffmpeg:" "$(command -v ffmpeg &>/dev/null && echo 'OK' || echo 'MISSING')"
printf "  %-20s %s\n" "whisper:" "$(command -v whisper &>/dev/null && echo 'OK' || echo 'MISSING')"
printf "  %-20s %s\n" "edge-tts:" "$(command -v edge-tts &>/dev/null && echo 'OK' || echo 'MISSING')"
printf "  %-20s %s\n" "numpy:" "$($PYTHON -c 'import numpy; print(numpy.__version__)' 2>/dev/null || echo 'MISSING')"
printf "  %-20s %s\n" "Python:" "$($PYTHON --version 2>&1)"
echo ""
echo "Done! 完成！"
