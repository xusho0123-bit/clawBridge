#!/bin/bash
# ============================================================
#  檢查 Bridge 運行環境
#  Check Bridge runtime environment
#
#  Usage: ./tools/check-env.sh
#  Shows status of all required tools and capabilities
# ============================================================

echo "=== Antigravity Bridge - 環境檢查 / Environment Check ==="
echo ""

OK=0
WARN=0
FAIL=0

check() {
    local NAME="$1"
    local CMD="$2"
    local DESC="$3"

    if command -v "$CMD" &>/dev/null; then
        printf "  [OK]   %-15s %s\n" "$NAME" "$DESC"
        OK=$((OK+1))
    else
        printf "  [FAIL] %-15s %s\n" "$NAME" "$DESC"
        FAIL=$((FAIL+1))
    fi
}

echo "--- 基礎工具 / Core Tools ---"
check "Node.js" "node" "$(node --version 2>/dev/null || echo 'not found')"
check "npm" "npm" "$(npm --version 2>/dev/null || echo 'not found')"
check "Python3" "python3" "$(python3 --version 2>&1 2>/dev/null || echo 'not found')"
echo ""

echo "--- 語音能力 / Voice Capabilities ---"
check "ffmpeg" "ffmpeg" "音訊轉換 Audio conversion"
check "whisper" "whisper" "語音辨識 STT"
check "edge-tts" "edge-tts" "語音合成 TTS"
echo ""

echo "--- Python 套件 / Python Packages ---"
for PKG in numpy torch whisper; do
    VER=$(python3 -c "import $PKG; print($PKG.__version__)" 2>/dev/null)
    if [ $? -eq 0 ]; then
        printf "  [OK]   %-15s %s\n" "$PKG" "$VER"
        OK=$((OK+1))
    else
        printf "  [FAIL] %-15s %s\n" "$PKG" "not installed"
        FAIL=$((FAIL+1))
    fi
done
echo ""

echo "--- Node.js 套件 / Node Packages ---"
BRIDGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
for PKG in dotenv node-telegram-bot-api; do
    if [ -d "$BRIDGE_DIR/node_modules/$PKG" ]; then
        printf "  [OK]   %-25s installed\n" "$PKG"
        OK=$((OK+1))
    else
        printf "  [FAIL] %-25s not found\n" "$PKG"
        FAIL=$((FAIL+1))
    fi
done
echo ""

echo "--- .env 設定 / Configuration ---"
ENV_FILE="$BRIDGE_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    if grep -q "TELEGRAM_BOT_TOKEN=" "$ENV_FILE" 2>/dev/null; then
        printf "  [OK]   %-25s configured\n" "TELEGRAM_BOT_TOKEN"
        OK=$((OK+1))
    else
        printf "  [FAIL] %-25s missing\n" "TELEGRAM_BOT_TOKEN"
        FAIL=$((FAIL+1))
    fi
    if grep -q "ALLOWED_USER_ID=" "$ENV_FILE" 2>/dev/null; then
        printf "  [OK]   %-25s configured\n" "ALLOWED_USER_ID"
        OK=$((OK+1))
    else
        printf "  [WARN] %-25s not set (anyone can use bot)\n" "ALLOWED_USER_ID"
        WARN=$((WARN+1))
    fi
else
    printf "  [FAIL] .env file not found. Run: npm run setup\n"
    FAIL=$((FAIL+1))
fi
echo ""

echo "=== 結果 / Result ==="
echo "  OK: $OK  |  WARN: $WARN  |  FAIL: $FAIL"
echo ""

if [ $FAIL -eq 0 ]; then
    echo "  All checks passed! Bridge is ready to run."
    echo "  所有檢查通過！Bridge 準備就緒。"
else
    echo "  Some checks failed. Run: ./tools/install-deps.sh"
    echo "  部分檢查失敗。執行: ./tools/install-deps.sh"
fi
