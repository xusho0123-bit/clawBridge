#!/usr/bin/env python3
"""
語音合成工具 / Text-to-Speech Tool
Antigravity Bridge — 本地 TTS，支援中/英/日/韓

Usage:
    python3 tools/voice_tts.py --text "你好世界"
    python3 tools/voice_tts.py --text "Hello" --voice en --output /tmp/hello.mp3
    python3 tools/voice_tts.py --text "很長的文字..." --split

Dependencies:
    pip install edge-tts
    (or: brew install ffmpeg  for macOS 'say' fallback)

參考 / Based on: docs/tools/telegram-offline-voice
"""

import asyncio
import argparse
import os
import re
import sys
import uuid
import subprocess

# Voice mapping 語音對照表
VOICES = {
    "zh": "zh-TW-HsiaoChenNeural",     # 繁體中文
    "zh-cn": "zh-CN-XiaoxiaoNeural",    # 簡體中文
    "en": "en-US-AriaNeural",           # English
    "ja": "ja-JP-NanamiNeural",         # 日本語
    "ko": "ko-KR-SunHiNeural",         # 한국어
}


def clean_markdown(text: str) -> str:
    """清洗 Markdown 符號 / Remove Markdown formatting"""
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)  # [text](url) → text
    text = re.sub(r'https?://\S+', '', text)                # URLs
    text = re.sub(r'[*_`#~]', '', text)                     # Markdown symbols
    text = re.sub(r'^-{3,}$', '', text, flags=re.MULTILINE) # ---
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def split_sentences(text: str, max_len: int = 200) -> list:
    """智能分段 / Split text into sentence chunks"""
    # Split by sentence endings
    parts = re.split(r'([。！？\.\!\?]+)', text)

    sentences = []
    current = ""

    for i, part in enumerate(parts):
        current += part
        # If this is a punctuation part, or current is long enough
        if re.match(r'^[。！？\.\!\?]+$', part) or len(current) >= max_len:
            if current.strip():
                sentences.append(current.strip())
            current = ""

    if current.strip():
        sentences.append(current.strip())

    return sentences if sentences else [text]


async def tts_edge(text: str, output: str, voice: str, rate: str = "+0%"):
    """使用 edge-tts 生成語音 / Generate speech with edge-tts"""
    try:
        import edge_tts
    except ImportError:
        print("edge-tts not installed. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "edge-tts", "-q"])
        import edge_tts

    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(output)
    return True


def tts_macos_say(text: str, output: str):
    """macOS fallback: 使用 say 指令 / Fallback using macOS say"""
    if sys.platform != "darwin":
        return False

    aiff = output.replace(".mp3", ".aiff").replace(".ogg", ".aiff")
    try:
        subprocess.run(["say", "-o", aiff, text], check=True, capture_output=True)
        # Convert to mp3 if ffmpeg available
        if output.endswith((".mp3", ".ogg")):
            subprocess.run(
                ["ffmpeg", "-i", aiff, "-y", output],
                check=True, capture_output=True
            )
            os.remove(aiff)
        else:
            os.rename(aiff, output)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


async def generate(text: str, voice_key: str = "zh", output: str = None,
                   rate: str = "+0%", split: bool = False, clean: bool = True):
    """主要生成函式 / Main generation function"""

    if clean:
        text = clean_markdown(text)

    if not text:
        print("ERROR: Empty text after cleaning")
        return []

    voice = VOICES.get(voice_key, voice_key)  # Allow direct voice name

    if split:
        segments = split_sentences(text)
    else:
        segments = [text]

    results = []

    for i, segment in enumerate(segments):
        if not segment.strip():
            continue

        if output and len(segments) == 1:
            out_path = output
        else:
            uid = uuid.uuid4().hex[:8]
            suffix = f"_{i}" if len(segments) > 1 else ""
            out_path = output or f"/tmp/tts_{uid}{suffix}.mp3"
            if len(segments) > 1:
                base, ext = os.path.splitext(out_path)
                out_path = f"{base}_{i}{ext}"

        try:
            await tts_edge(segment, out_path, voice, rate)
            size = os.path.getsize(out_path)
            print(f"OK: {out_path} ({size} bytes)")
            results.append(out_path)
        except Exception as e:
            print(f"edge-tts failed: {e}, trying macOS say...")
            if tts_macos_say(segment, out_path):
                size = os.path.getsize(out_path)
                print(f"OK: {out_path} ({size} bytes, macOS say)")
                results.append(out_path)
            else:
                print(f"ERROR: All TTS engines failed for segment {i}")

    return results


def main():
    parser = argparse.ArgumentParser(
        description="語音合成工具 / Text-to-Speech Tool"
    )
    parser.add_argument("--text", "-t", required=True, help="要合成的文字 / Text to speak")
    parser.add_argument("--voice", "-v", default="zh",
                        help="語音: zh, zh-cn, en, ja, ko (or full voice name)")
    parser.add_argument("--output", "-o", default=None,
                        help="輸出路徑 / Output path (default: /tmp/tts_*.mp3)")
    parser.add_argument("--rate", "-r", default="+0%",
                        help="語速 / Speech rate (e.g. +10%%, -5%%)")
    parser.add_argument("--split", "-s", action="store_true",
                        help="自動分段 / Auto-split long text into segments")
    parser.add_argument("--no-clean", action="store_true",
                        help="不清洗 Markdown / Don't remove Markdown formatting")

    args = parser.parse_args()

    results = asyncio.run(generate(
        text=args.text,
        voice_key=args.voice,
        output=args.output,
        rate=args.rate,
        split=args.split,
        clean=not args.no_clean,
    ))

    if not results:
        sys.exit(1)

    # Output for bridge integration (MEDIA tag format)
    for path in results:
        print(f"MEDIA: {path}")


if __name__ == "__main__":
    main()
