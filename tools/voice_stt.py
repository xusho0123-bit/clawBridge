#!/usr/bin/env python3
"""
語音辨識工具 / Speech-to-Text Tool
Antigravity Bridge — 本地 STT，使用 OpenAI Whisper

Usage:
    python3 tools/voice_stt.py /path/to/audio.ogg
    python3 tools/voice_stt.py /path/to/audio.wav --lang en
    python3 tools/voice_stt.py /path/to/audio.mp3 --model large

Dependencies:
    pip install openai-whisper "numpy<1.26"
    brew install ffmpeg  (or apt install ffmpeg)

支援格式 / Supported formats: ogg, oga, wav, mp3, m4a, flac, aac
"""

import argparse
import os
import subprocess
import sys
import tempfile


def check_whisper():
    """檢查 whisper 是否安裝 / Check if whisper is installed"""
    try:
        import whisper
        return True
    except ImportError:
        return False


def install_whisper():
    """嘗試安裝 whisper / Try to install whisper"""
    print("whisper not found. Installing...")
    try:
        subprocess.check_call([
            sys.executable, "-m", "pip", "install",
            "numpy<1.26", "-q"
        ])
        subprocess.check_call([
            sys.executable, "-m", "pip", "install",
            "openai-whisper", "-q"
        ])
        return True
    except subprocess.CalledProcessError as e:
        print(f"ERROR: Failed to install whisper: {e}")
        return False


def convert_to_wav(input_path: str) -> str:
    """轉換為 WAV 16kHz mono / Convert to WAV 16kHz mono"""
    ext = os.path.splitext(input_path)[1].lower()

    if ext == ".wav":
        return input_path

    # Check ffmpeg
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("ERROR: ffmpeg not found. Install: brew install ffmpeg")
        sys.exit(1)

    wav_path = tempfile.mktemp(suffix=".wav")
    subprocess.run(
        ["ffmpeg", "-i", input_path, "-ar", "16000", "-ac", "1", "-y", wav_path],
        capture_output=True, check=True
    )
    return wav_path


def transcribe(audio_path: str, lang: str = "zh", model_name: str = "turbo") -> str:
    """辨識語音 / Transcribe audio"""
    import whisper

    print(f"Loading model '{model_name}'...")
    model = whisper.load_model(model_name)

    options = {}
    if lang != "auto":
        options["language"] = lang

    print("Transcribing...")
    result = model.transcribe(audio_path, **options)

    return result["text"].strip()


def main():
    parser = argparse.ArgumentParser(
        description="語音辨識工具 / Speech-to-Text Tool"
    )
    parser.add_argument("audio", help="音訊檔路徑 / Audio file path")
    parser.add_argument("--lang", "-l", default="zh",
                        help="語言: zh, en, ja, ko, auto (default: zh)")
    parser.add_argument("--model", "-m", default="turbo",
                        help="模型: turbo, base, small, medium, large (default: turbo)")

    args = parser.parse_args()

    if not os.path.exists(args.audio):
        print(f"ERROR: File not found: {args.audio}")
        sys.exit(1)

    # Check / install whisper
    if not check_whisper():
        if not install_whisper():
            sys.exit(1)

    # Convert audio format if needed
    wav_path = convert_to_wav(args.audio)
    is_temp = wav_path != args.audio

    try:
        text = transcribe(wav_path, lang=args.lang, model_name=args.model)
        print(f"\n=== 辨識結果 / Transcription ===")
        print(text)
    finally:
        # Cleanup temp file
        if is_temp and os.path.exists(wav_path):
            os.remove(wav_path)


if __name__ == "__main__":
    main()
