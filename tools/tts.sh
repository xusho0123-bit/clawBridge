#!/bin/bash
# ============================================================
#  TTS (Text-to-Speech) 語音合成工具
#  Text-to-Speech tool for Antigravity Bridge
#
#  Usage:
#    ./tools/tts.sh "要說的文字" /tmp/output.mp3
#    ./tools/tts.sh "Hello world" /tmp/output.mp3 en
#
#  Dependencies: edge-tts (pip install edge-tts)
#  Fallback: macOS 'say' command
# ============================================================

TEXT="$1"
OUTPUT="$2"
LANG="${3:-zh}"

if [ -z "$TEXT" ] || [ -z "$OUTPUT" ]; then
    echo "Usage: $0 <text> <output.mp3> [lang]"
    echo "  lang: zh (default), en, ja, ko"
    exit 1
fi

# Voice mapping
case "$LANG" in
    zh)  VOICE="zh-TW-HsiaoChenNeural" ;;
    en)  VOICE="en-US-AriaNeural" ;;
    ja)  VOICE="ja-JP-NanamiNeural" ;;
    ko)  VOICE="ko-KR-SunHiNeural" ;;
    *)   VOICE="zh-TW-HsiaoChenNeural" ;;
esac

# Try edge-tts first
if command -v edge-tts &>/dev/null; then
    edge-tts --voice "$VOICE" --text "$TEXT" --write-media "$OUTPUT" 2>/dev/null
    if [ $? -eq 0 ] && [ -f "$OUTPUT" ]; then
        echo "OK: $OUTPUT (edge-tts, $VOICE)"
        exit 0
    fi
fi

# Fallback: macOS say
if command -v say &>/dev/null; then
    AIFF_TMP="${OUTPUT%.mp3}.aiff"
    say -o "$AIFF_TMP" "$TEXT"
    if command -v ffmpeg &>/dev/null; then
        ffmpeg -i "$AIFF_TMP" -y "$OUTPUT" 2>/dev/null
        rm -f "$AIFF_TMP"
    else
        mv "$AIFF_TMP" "$OUTPUT"
    fi
    echo "OK: $OUTPUT (macOS say)"
    exit 0
fi

echo "ERROR: No TTS engine found. Install edge-tts: pip install edge-tts"
exit 1
