#!/bin/bash
# ============================================================
#  STT (Speech-to-Text) 語音辨識工具
#  Speech-to-Text tool for Antigravity Bridge
#
#  Usage:
#    ./tools/stt.sh /path/to/audio.ogg
#    ./tools/stt.sh /path/to/audio.wav zh
#    ./tools/stt.sh /path/to/audio.mp3 en large
#
#  Dependencies: whisper (pip install openai-whisper), ffmpeg
#  Output: Transcribed text to stdout
# ============================================================

AUDIO="$1"
LANG="${2:-zh}"
MODEL="${3:-turbo}"

if [ -z "$AUDIO" ]; then
    echo "Usage: $0 <audio_file> [lang] [model]"
    echo "  lang:  zh (default), en, ja, ko, auto"
    echo "  model: turbo (default), base, small, medium, large"
    exit 1
fi

if [ ! -f "$AUDIO" ]; then
    echo "ERROR: File not found: $AUDIO"
    exit 1
fi

# Check whisper
if ! command -v whisper &>/dev/null; then
    echo "ERROR: whisper not found. Install: pip install openai-whisper"
    exit 1
fi

# Convert to WAV if needed (whisper works best with 16kHz mono WAV)
EXT="${AUDIO##*.}"
TMPWAV=""

if [ "$EXT" = "ogg" ] || [ "$EXT" = "oga" ] || [ "$EXT" = "m4a" ] || [ "$EXT" = "mp3" ]; then
    if ! command -v ffmpeg &>/dev/null; then
        echo "ERROR: ffmpeg not found (needed to convert $EXT)"
        exit 1
    fi
    TMPWAV="/tmp/stt_$(date +%s).wav"
    ffmpeg -i "$AUDIO" -ar 16000 -ac 1 -y "$TMPWAV" 2>/dev/null
    AUDIO="$TMPWAV"
fi

# Build whisper args
WHISPER_ARGS=("$AUDIO" --model "$MODEL" --output_format txt --output_dir /tmp)

if [ "$LANG" != "auto" ]; then
    WHISPER_ARGS+=(--language "$LANG")
fi

# Run whisper
whisper "${WHISPER_ARGS[@]}" 2>/dev/null

# Read output
BASENAME=$(basename "$AUDIO" | sed 's/\.[^.]*$//')
TXT_FILE="/tmp/${BASENAME}.txt"

if [ -f "$TXT_FILE" ]; then
    cat "$TXT_FILE"
    rm -f "$TXT_FILE"
else
    echo "ERROR: Transcription failed"
    exit 1
fi

# Cleanup
[ -n "$TMPWAV" ] && rm -f "$TMPWAV"
