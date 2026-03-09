// lib/telegram/media.js — 媒體處理
// MIME 偵測、AI 回應媒體標記解析、檔案下載、語音轉文字

import { existsSync, createWriteStream, readFileSync, mkdirSync, unlinkSync } from 'fs';
import { extname, join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import http from 'http';

const execFileAsync = promisify(execFile);

// ============================================================
//  Media MIME type detection (for inline media via API)
// ============================================================

const INLINE_MEDIA_MIME_TYPES = {
    // Images
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    // Audio (Gemini supports audio recognition)
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    // Documents (faster via media field than file path + VIEW_FILE)
    '.pdf': 'application/pdf',
};

export function getInlineMediaMimeType(ext) {
    return INLINE_MEDIA_MIME_TYPES[ext.toLowerCase()] || null;
}

// ============================================================
//  Media detection: parse MEDIA: tags from AI response
// ============================================================

const MEDIA_REGEX = /MEDIA:\s*(.+?)(?:\n|$)/g;
const VOICE_FLAG_REGEX = /asVoice:\s*true/i;

export function extractMedia(text) {
    const media = [];
    let match;
    const regex = new RegExp(MEDIA_REGEX.source, 'g');
    while ((match = regex.exec(text)) !== null) {
        const filePath = match[1].trim();
        media.push({ filePath, index: match.index, fullMatch: match[0] });
    }

    // Check for asVoice flag
    const asVoice = VOICE_FLAG_REGEX.test(text);

    // Remove MEDIA: and asVoice: lines from text
    let cleanText = text
        .replace(/MEDIA:\s*.+?(?:\n|$)/g, '')
        .replace(/asVoice:\s*\w+\s*(?:\n|$)/gi, '')
        .trim();

    return { media, asVoice, cleanText };
}

export function getMediaType(filePath, asVoice) {
    const ext = extname(filePath).toLowerCase();
    if (asVoice || ext === '.ogg' || ext === '.oga') return 'voice';
    if (['.mp3', '.wav', '.flac', '.m4a', '.aac'].includes(ext)) return 'audio';
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) return 'photo';
    if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video';
    return 'document';
}

// ============================================================
//  File download helper: TG file → local path
// ============================================================

export const DOWNLOAD_DIR = join(process.cwd(), 'downloads');
mkdirSync(DOWNLOAD_DIR, { recursive: true });

export function downloadFile(url, dest, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const file = createWriteStream(dest);
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                file.close();
                return downloadFile(res.headers.location, dest, timeoutMs).then(resolve).catch(reject);
            }
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(dest); });
        });
        req.on('error', (err) => { file.close(); reject(err); });
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            file.close();
            reject(new Error(`Download timeout after ${timeoutMs / 1000}s`));
        });
    });
}

// Helper: extract file_id and file metadata from any TG message type
export async function extractFileInfo(msg) {
    if (msg.photo && msg.photo.length > 0) {
        const photo = msg.photo[msg.photo.length - 1];
        return { fileId: photo.file_id, type: 'photo', ext: '.jpg' };
    }
    if (msg.document) {
        const ext = extname(msg.document.file_name || '') || '';
        return { fileId: msg.document.file_id, type: 'document', ext, fileName: msg.document.file_name };
    }
    if (msg.voice) {
        return { fileId: msg.voice.file_id, type: 'voice', ext: '.ogg' };
    }
    if (msg.audio) {
        const ext = extname(msg.audio.file_name || '') || '.mp3';
        return { fileId: msg.audio.file_id, type: 'audio', ext, fileName: msg.audio.file_name };
    }
    if (msg.video) {
        return { fileId: msg.video.file_id, type: 'video', ext: '.mp4' };
    }
    if (msg.video_note) {
        return { fileId: msg.video_note.file_id, type: 'video', ext: '.mp4' };
    }
    if (msg.sticker) {
        const ext = msg.sticker.is_animated ? '.tgs' : msg.sticker.is_video ? '.webm' : '.webp';
        return { fileId: msg.sticker.file_id, type: 'sticker', ext };
    }
    return null;
}

// Download TG file to local downloads/ folder
export async function downloadTgFile(bot, config, fileInfo) {
    const tgFile = await bot.getFile(fileInfo.fileId);
    const url = `https://api.telegram.org/file/bot${config.tgToken}/${tgFile.file_path}`;
    const fileName = fileInfo.fileName || `${fileInfo.type}_${Date.now()}${fileInfo.ext}`;
    const localPath = join(DOWNLOAD_DIR, fileName);
    await downloadFile(url, localPath);
    return localPath;
}

// ============================================================
//  Speech-to-Text via Whisper CLI
// ============================================================

const WHISPER_MODEL = process.env.WHISPER_MODEL || 'turbo';
const WHISPER_LANG = process.env.WHISPER_LANGUAGE || 'zh';

export async function transcribeAudio(audioPath) {
    const outputDir = DOWNLOAD_DIR;
    try {
        const { stdout, stderr } = await execFileAsync('whisper', [
            audioPath,
            '--model', WHISPER_MODEL,
            '--language', WHISPER_LANG,
            '--output_format', 'txt',
            '--output_dir', outputDir,
        ], { timeout: 120000 });

        const baseName = audioPath.replace(/\.[^.]+$/, '');
        const txtPath = join(outputDir, baseName.split('/').pop() + '.txt');

        if (existsSync(txtPath)) {
            const text = readFileSync(txtPath, 'utf8').trim();
            try { unlinkSync(txtPath); } catch {}
            return text || null;
        }

        if (stdout && stdout.trim()) {
            return stdout.trim();
        }

        return null;
    } catch (err) {
        console.error(`  STT error: ${err.message}`);
        return null;
    }
}

export { WHISPER_MODEL, execFileAsync };
