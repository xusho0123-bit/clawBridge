#!/bin/bash
# ============================================================
#  音訊轉換工具
#  Audio conversion tool for Antigravity Bridge
#
#  Usage:
#    ./tools/convert-audio.sh input.ogg output.wav
#    ./tools/convert-audio.sh input.m4a output.mp3
#    ./tools/convert-audio.sh input.ogg   (auto: input.wav)
#
#  Dependencies: ffmpeg
# ============================================================

INPUT="$1"
OUTPUT="$2"

if [ -z "$INPUT" ]; then
    echo "Usage: $0 <input_audio> [output_audio]"
    echo ""
    echo "Supported formats: ogg, oga, m4a, mp3, wav, flac, aac"
    echo "Default output: WAV 16kHz mono (optimal for Whisper)"
    exit 1
fi

if [ ! -f "$INPUT" ]; then
    echo "ERROR: File not found: $INPUT"
    exit 1
fi

if ! command -v ffmpeg &>/dev/null; then
    echo "ERROR: ffmpeg not found. Install: brew install ffmpeg"
    exit 1
fi

# Default output: same name, .wav extension
if [ -z "$OUTPUT" ]; then
    OUTPUT="${INPUT%.*}.wav"
fi

# Convert
OUT_EXT="${OUTPUT##*.}"
if [ "$OUT_EXT" = "wav" ]; then
    # Optimize for Whisper: 16kHz mono
    ffmpeg -i "$INPUT" -ar 16000 -ac 1 -y "$OUTPUT" 2>/dev/null
else
    ffmpeg -i "$INPUT" -y "$OUTPUT" 2>/dev/null
fi

if [ $? -eq 0 ] && [ -f "$OUTPUT" ]; then
    SIZE=$(wc -c < "$OUTPUT" | tr -d ' ')
    echo "OK: $OUTPUT ($SIZE bytes)"
else
    echo "ERROR: Conversion failed"
    exit 1
fi
