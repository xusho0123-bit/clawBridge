// lib/telegram.js — Telegram Bot handler with message queue + streaming + STT
// Telegram Bot 訊息處理（含訊息佇列 + 流式傳輸 + 自動恢復 + 語音辨識）

import TelegramBot from 'node-telegram-bot-api';
import { existsSync, createReadStream, mkdirSync, createWriteStream, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { extname, join } from 'path';
import { homedir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import http from 'http';
import { saveSession, clearSession, appendHistory, loadHistory } from './history.js';
import { loadSchedules, addSchedule, removeSchedule, getTriggeredSchedules } from './scheduler.js';
import {
    loadPins, addPin, removePin, clearPins, formatPinsForInjection,
    loadNotes, addNote, removeNote, searchNotes, formatNotesForInjection,
    searchHistory, formatRecallForInjection,
    buildMemoryContext, extractMemoryMarkers, getMemorySummary,
} from './memory.js';

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

function getInlineMediaMimeType(ext) {
    return INLINE_MEDIA_MIME_TYPES[ext.toLowerCase()] || null;
}

// ============================================================
//  IDE Settings helper: read/write Antigravity settings.json
// ============================================================

const IDE_SETTINGS_PATH = process.platform === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Antigravity', 'User', 'settings.json')
    : join(homedir(), 'Library', 'Application Support', 'Antigravity', 'User', 'settings.json');

function readIdeSettings() {
    try {
        return JSON.parse(readFileSync(IDE_SETTINGS_PATH, 'utf8'));
    } catch { return {}; }
}

function writeIdeSettings(settings) {
    writeFileSync(IDE_SETTINGS_PATH, JSON.stringify(settings, null, 4) + '\n', 'utf8');
}

// Auto-approve setting keys
const APPROVE_KEYS = {
    edits: 'chat.tools.edits.autoApprove',
    terminal: 'chat.tools.terminal.autoApprove',
    urls: 'chat.tools.urls.autoApprove',
    all: 'chat.tools.global.autoApprove',
};

// ============================================================
//  Media detection: parse MEDIA: tags from AI response
// ============================================================

const MEDIA_REGEX = /MEDIA:\s*(.+?)(?:\n|$)/g;
const VOICE_FLAG_REGEX = /asVoice:\s*true/i;

function extractMedia(text) {
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

function getMediaType(filePath, asVoice) {
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

const DOWNLOAD_DIR = join(process.cwd(), 'downloads');
mkdirSync(DOWNLOAD_DIR, { recursive: true });

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = createWriteStream(dest);
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                // Follow redirect
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(dest); });
        }).on('error', (err) => { file.close(); reject(err); });
    });
}

// ============================================================
//  Speech-to-Text via Whisper CLI
// ============================================================

const WHISPER_MODEL = process.env.WHISPER_MODEL || 'turbo';

async function transcribeAudio(audioPath) {
    const outputDir = DOWNLOAD_DIR;
    try {
        const { stdout, stderr } = await execFileAsync('whisper', [
            audioPath,
            '--model', WHISPER_MODEL,
            '--language', 'zh',
            '--output_format', 'txt',
            '--output_dir', outputDir,
        ], { timeout: 120000 });

        // Whisper outputs a .txt file with same basename
        const baseName = audioPath.replace(/\.[^.]+$/, '');
        const txtPath = join(outputDir, baseName.split('/').pop() + '.txt');

        if (existsSync(txtPath)) {
            const text = readFileSync(txtPath, 'utf8').trim();
            // Clean up the .txt file
            try { unlinkSync(txtPath); } catch {}
            return text || null;
        }

        // Fallback: try to extract from stdout
        if (stdout && stdout.trim()) {
            return stdout.trim();
        }

        return null;
    } catch (err) {
        console.error(`  STT error: ${err.message}`);
        return null;
    }
}

export function startTelegramBot(config, rpc, reconnectFn) {
    const bot = new TelegramBot(config.tgToken, { polling: true });

    // 註冊 TG Bot 指令選單（打 / 時會自動提示）
    bot.setMyCommands([
        { command: 'newchat',  description: '🔄 開新對話' },
        { command: 'model',    description: '🤖 切換 AI 模型' },
        { command: 'status',   description: '📊 連線狀態' },
        { command: 'cancel',   description: '⛔ 取消 AI 執行' },
        { command: 'pin',      description: '📌 管理釘選（常駐注入 AI）' },
        { command: 'note',     description: '📝 管理筆記（關鍵字匹配）' },
        { command: 'help',     description: '❓ 指令說明' },
    ]).then(() => console.log('  ✅ TG 指令選單已註冊'))
      .catch(e => console.error('  ❌ 註冊指令選單失敗:', e.message));

    // Message queue: one at a time, no concurrent AI calls
    let processing = false;
    let processingStartedAt = 0;
    const queue = [];
    let lastKnownChatId = null;

    async function processQueue() {
        if (processing || queue.length === 0) return;
        processing = true;
        processingStartedAt = Date.now();

        const { chatId, text, firstName, mediaItems, memoryContext } = queue.shift();

        console.log(`  TG [${firstName}]: "${text.substring(0, 60)}"`);
        let statusMsg;
        try {
            bot.sendChatAction(chatId, 'typing').catch(() => {});
            statusMsg = await bot.sendMessage(chatId, '⏳ 思考中...');
        } catch {
            // Can't even send status message, skip
            processing = false;
            processQueue();
            return;
        }

        // Typing indicator: refresh every 4s (TG typing badge expires after ~5s)
        const typingInterval = setInterval(() => {
            bot.sendChatAction(chatId, 'typing').catch(() => {});
        }, 4000);

        try {
            let lastEditTime = 0;

            // Streaming callback: update TG message as AI generates text
            const onUpdate = (partial) => {
                const now = Date.now();
                if (now - lastEditTime < 300) return; // 300ms throttle (v2.6: was 3000ms)
                lastEditTime = now;
                const preview = partial.length > 4000
                    ? partial.substring(partial.length - 4000)
                    : partial;
                bot.editMessageText(preview + ' ⏳', {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                }).catch(() => {});
            };

            // Permission callback: send inline buttons for Allow/Deny
            const onPermission = (info) => {
                const settings = readIdeSettings();

                // YOLO mode: auto-approve
                if (settings[APPROVE_KEYS.all]) {
                    rpc.handlePermission(info.trajectoryId, info.stepIndex, info.type, true);
                    console.log(`  🟢 Auto-approved: ${info.type}${info.cmd ? ' → ' + info.cmd : ''}`);
                    return;
                }

                // Check individual settings
                const typeKey = info.type === 'run_command' ? 'terminal' : info.type === 'file' ? 'edits' : info.type;
                if (settings[APPROVE_KEYS[typeKey]]) {
                    rpc.handlePermission(info.trajectoryId, info.stepIndex, info.type, true);
                    console.log(`  🟢 Auto-approved (${typeKey}): ${info.type}${info.cmd ? ' → ' + info.cmd : ''}`);
                    return;
                }

                // Ask user via inline buttons
                // Type abbreviations to avoid underscore conflicts + stay within 64-byte callback_data limit
                const typeAbbr = { run_command: 'cmd', file: 'file', browser: 'br', mcp: 'mcp' };
                const abbr = typeAbbr[info.type] || 'br';

                const label = info.type === 'run_command' ? `🖥 ${info.cmd || 'command'}`
                    : info.type === 'file' ? `📝 ${info.path || 'file'}`
                    : info.type === 'mcp' ? '🔌 MCP tool'
                    : '🌐 Browser action';

                bot.sendMessage(chatId, `⚠️ AI 需要權限：${label}`, {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ Allow', callback_data: `pa_${info.trajectoryId}_${info.stepIndex}_${abbr}` },
                            { text: '❌ Deny', callback_data: `pd_${info.trajectoryId}_${info.stepIndex}_${abbr}` },
                        ]],
                    },
                }).catch(() => {});
            };

            const response = await rpc.sendToAI(text, config.model, onUpdate, config.pollTimeout, mediaItems, memoryContext || '', onPermission);

            // Final message: delete streaming msg, send full response
            try { await bot.deleteMessage(chatId, statusMsg.message_id); } catch { }

            // === Process memory markers (REMEMBER: / RECALL:) ===
            const memoryResult = extractMemoryMarkers(response);
            let processedResponse = memoryResult.cleanText;

            // Auto-save REMEMBER: markers as notes
            for (const rem of memoryResult.remembers) {
                const result = addNote({ content: rem.content, tags: rem.tags, source: 'ai' });
                if (result.ok) {
                    console.log(`  🧠 AI remembered: #${result.note.id} "${rem.content.substring(0, 40)}"`);
                }
            }

            // Handle RECALL: markers — search history and log
            // (Full re-query with context would need a second AI call, so we just log for now)
            for (const keyword of memoryResult.recalls) {
                const found = searchHistory(keyword, 3);
                if (found.length > 0) {
                    console.log(`  🔍 AI recall "${keyword}": ${found.length} results`);
                    // Append recall results as a note to the response
                    const recallText = formatRecallForInjection(found);
                    processedResponse += `\n\n${recallText}`;
                }
            }

            // === Check for media files in response ===
            const { media, asVoice, cleanText } = extractMedia(processedResponse);

            // Send text part (if any)
            if (cleanText) {
                const MAX = 4000;
                for (let i = 0; i < cleanText.length; i += MAX) {
                    await bot.sendMessage(chatId, cleanText.substring(i, i + MAX));
                }
            }

            // Send media files
            for (const m of media) {
                if (!existsSync(m.filePath)) {
                    console.log(`  Media file not found: ${m.filePath}`);
                    await bot.sendMessage(chatId, `⚠ File not found: ${m.filePath}`);
                    continue;
                }
                const type = getMediaType(m.filePath, asVoice);
                const stream = createReadStream(m.filePath);
                try {
                    switch (type) {
                        case 'voice':
                            await bot.sendVoice(chatId, stream);
                            console.log(`  Sent voice: ${m.filePath}`);
                            break;
                        case 'audio':
                            await bot.sendAudio(chatId, stream);
                            console.log(`  Sent audio: ${m.filePath}`);
                            break;
                        case 'photo':
                            await bot.sendPhoto(chatId, stream);
                            console.log(`  Sent photo: ${m.filePath}`);
                            break;
                        case 'video':
                            await bot.sendVideo(chatId, stream);
                            console.log(`  Sent video: ${m.filePath}`);
                            break;
                        default:
                            await bot.sendDocument(chatId, stream);
                            console.log(`  Sent document: ${m.filePath}`);
                    }
                } catch (mediaErr) {
                    console.error(`  Media send error: ${mediaErr.message}`);
                    await bot.sendMessage(chatId, `⚠ Failed to send: ${m.filePath}`);
                }
            }

            const mediaInfo = media.length > 0 ? ` + ${media.length} media` : '';
            console.log(`  Sent ${cleanText.length} chars${mediaInfo} to TG`);

            // Save to history (strip [歷史回顧] blocks to prevent recall loops)
            appendHistory('user', text);
            const historyText = (cleanText || response).replace(/\n*\[歷史回顧\][\s\S]*?(?=\n\n|\n*$)/g, '').trim();
            appendHistory('ai', historyText || cleanText || response);

            // Save session state
            const state = rpc.getState();
            if (state.cascadeId) saveSession({ cascadeId: state.cascadeId });
        } catch (err) {
            console.error(`  Error: ${err.message}`);
            try { await bot.deleteMessage(chatId, statusMsg.message_id); } catch { }

            // Auto-reconnect on connection errors
            if (err.message.includes('ECONNREFUSED') || err.message.includes('request:')) {
                console.log('  Connection lost, auto-reconnecting...');
                const conn = await reconnectFn();
                if (conn) {
                    rpc.updateConnection(conn);
                    rpc.resetCascade();
                    bot.sendMessage(chatId, 'Connection lost and restored. Please resend.');
                } else {
                    bot.sendMessage(chatId, 'Connection lost. Is Antigravity running? Use /reconnect');
                }
            } else if (err.message.includes('timeout') || err.message.includes('Timeout')) {
                // Timeout 可能是 port 變了或伺服器塞車，嘗試重新偵測
                console.log('  Timeout detected, attempting re-detect...');
                const conn = await reconnectFn();
                if (conn) {
                    rpc.updateConnection(conn);
                    rpc.resetCascade();
                    bot.sendMessage(chatId, '⏱ AI 回應超時，已重新連線。請再傳一次。\n💡 如果持續超時，用 /model 換個模型試試。');
                } else {
                    bot.sendMessage(chatId, '⏱ AI 回應超時。可能原因：\n1. AI 伺服器塞車 → 用 /model 換模型\n2. Antigravity IDE 沒開\n3. 用 /reconnect 重連');
                }
            } else if (err.message.includes('cascade') || err.message.includes('INTERNAL')
                || err.message.includes('404') || err.message.includes('400')) {
                rpc.resetCascade();
                bot.sendMessage(chatId, `Error, conversation reset. Please try again.`);
            } else {
                bot.sendMessage(chatId, `Error: ${err.message}`);
            }
        } finally {
            clearInterval(typingInterval);
        }

        processing = false;
        processingStartedAt = 0;
        processQueue(); // Process next in queue
    }

    // Safety: unstick the queue if processing hangs for too long
    // pollTimeout + 60s buffer
    const stuckTimeout = config.pollTimeout + 60000;
    setInterval(() => {
        if (processing && processingStartedAt > 0
            && Date.now() - processingStartedAt > stuckTimeout) {
            console.error(`  Queue stuck for ${Math.round(stuckTimeout/1000)}s, force-resetting...`);
            processing = false;
            processingStartedAt = 0;
            rpc.resetCascade();
            processQueue();
        }
    }, 10000);

    // Inline keyboard menu
    const menuKeyboard = {
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [
                    { text: '🔄 新對話', callback_data: 'newchat' },
                    { text: '📊 狀態', callback_data: 'status' },
                    { text: '🔗 重連', callback_data: 'reconnect' },
                ],
                [
                    { text: '⚡ YOLO', callback_data: 'yolo' },
                    { text: '🔒 安全', callback_data: 'safe' },
                    { text: '⛔ 取消', callback_data: 'cancel_ai' },
                ],
            ],
        }),
    };

    console.log('  Telegram bot started (polling)');

    // Helper: extract file_id and file metadata from any message type
    async function extractFileInfo(msg) {
        // Photo (pick largest resolution)
        if (msg.photo && msg.photo.length > 0) {
            const photo = msg.photo[msg.photo.length - 1];
            return { fileId: photo.file_id, type: 'photo', ext: '.jpg' };
        }
        // Document
        if (msg.document) {
            const ext = extname(msg.document.file_name || '') || '';
            return { fileId: msg.document.file_id, type: 'document', ext, fileName: msg.document.file_name };
        }
        // Voice
        if (msg.voice) {
            return { fileId: msg.voice.file_id, type: 'voice', ext: '.ogg' };
        }
        // Audio
        if (msg.audio) {
            const ext = extname(msg.audio.file_name || '') || '.mp3';
            return { fileId: msg.audio.file_id, type: 'audio', ext, fileName: msg.audio.file_name };
        }
        // Video
        if (msg.video) {
            return { fileId: msg.video.file_id, type: 'video', ext: '.mp4' };
        }
        // Video note (round video)
        if (msg.video_note) {
            return { fileId: msg.video_note.file_id, type: 'video', ext: '.mp4' };
        }
        // Sticker
        if (msg.sticker) {
            const ext = msg.sticker.is_animated ? '.tgs' : msg.sticker.is_video ? '.webm' : '.webp';
            return { fileId: msg.sticker.file_id, type: 'sticker', ext };
        }
        return null;
    }

    // Download TG file to local downloads/ folder
    async function downloadTgFile(fileInfo) {
        const tgFile = await bot.getFile(fileInfo.fileId);
        const url = `https://api.telegram.org/file/bot${config.tgToken}/${tgFile.file_path}`;
        const fileName = fileInfo.fileName || `${fileInfo.type}_${Date.now()}${fileInfo.ext}`;
        const localPath = join(DOWNLOAD_DIR, fileName);
        await downloadFile(url, localPath);
        return localPath;
    }

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userId = String(msg.from.id);
        if (config.allowedUsers && !config.allowedUsers.includes(userId)) return;
        lastKnownChatId = chatId;

        const text = msg.text || msg.caption || '';

        // === Commands (no queue needed) ===
        if (text === '/start' || text === '/help' || text === '/?') {
            bot.sendMessage(chatId, [
                'Antigravity Bridge v2.6',
                '',
                '💬 直接輸入訊息與 AI 對話',
                '📷 支援傳圖片 / 貼圖，AI 直接辨識',
                '🎤 支援語音訊息（Whisper 自動轉文字）',
                '📄 支援 PDF 文件讀取',
                '📎 支援傳檔案（程式碼等）',
                '',
                '── 基本指令 ──',
                '/status — 連線狀態',
                '/newchat — 新對話',
                '/reconnect — 重新連線',
                '/cancel — 取消 AI 執行',
                '/model — 切換 AI 模型',
                '/cascades — 列出對話',
                '',
                '── 記憶系統 ──',
                '/pin — 管理釘選（常駐注入）',
                '/note — 管理筆記（關鍵字匹配）',
                '/recall 關鍵字 — 搜尋歷史對話',
                '/memory — 記憶總覽',
                '',
                '── 排程 ──',
                '/schedule — 查看排程',
                '/schedule add HH:MM 訊息 — 新增每日排程',
                '/schedule remove <id> — 刪除排程',
                '',
                '── 權限控制 ──',
                '/approve — 查看目前權限',
                '/yolo — 全部自動核准（危險）',
                '/safe — 回到安全模式',
                '/approve edits on — 開啟檔案編輯自動核准',
                '/approve terminal off — 關閉終端機自動核准',
                '',
                '可用類型: edits, terminal, urls, all',
            ].join('\n'));
            return;
        }

        if (text === '/status') {
            const settings = readIdeSettings();
            const history = loadHistory();
            const mem = getMemorySummary();
            const approveStatus = Object.entries(APPROVE_KEYS)
                .map(([name, key]) => `  ${name}: ${settings[key] ? '✅ 自動' : '🔒 要問'}`)
                .join('\n');
            bot.sendMessage(chatId, [
                'Bridge Status:',
                `Connected: ${rpc.connected ? 'Yes' : 'No'}`,
                `Model: ${config.model}`,
                `Cascade: ${rpc.currentCascade?.substring(0, 8) || '(none)'}`,
                `Queue: ${queue.length} pending`,
                `Processing: ${processing ? 'Yes' : 'No'}`,
                '',
                `Memory: 📌${mem.pins.count} 📝${mem.notes.count} 💬${mem.history.count}`,
                '',
                'Auto-Approve:',
                approveStatus,
            ].join('\n'));
            return;
        }

        // === /approve — view or change auto-approve settings ===
        if (text === '/approve') {
            const settings = readIdeSettings();
            const lines = Object.entries(APPROVE_KEYS).map(([name, key]) =>
                `${settings[key] ? '✅' : '🔒'} ${name} — ${settings[key] ? '自動核准' : '需要同意'}`
            );
            bot.sendMessage(chatId, [
                '🔐 目前權限設定:',
                '',
                ...lines,
                '',
                '用法: /approve <類型> <on|off>',
                '例如: /approve edits on',
                '類型: edits, terminal, urls, all',
            ].join('\n'));
            return;
        }

        if (text.startsWith('/approve ')) {
            const parts = text.split(' ');
            const target = parts[1];
            const action = parts[2];
            if (!APPROVE_KEYS[target]) {
                bot.sendMessage(chatId, `❌ 未知類型: ${target}\n可用: edits, terminal, urls, all`);
                return;
            }
            if (action !== 'on' && action !== 'off') {
                bot.sendMessage(chatId, '❌ 用法: /approve <類型> <on|off>');
                return;
            }
            const settings = readIdeSettings();
            const value = action === 'on';
            if (target === 'all') {
                // YOLO mode affects all
                settings[APPROVE_KEYS.all] = value;
                if (value) {
                    bot.sendMessage(chatId, '⚠️ YOLO mode ON — 所有操作自動核准！');
                } else {
                    delete settings[APPROVE_KEYS.all];
                    bot.sendMessage(chatId, '🔒 YOLO mode OFF');
                }
            } else {
                settings[APPROVE_KEYS[target]] = value;
                bot.sendMessage(chatId, `${value ? '✅' : '🔒'} ${target}: ${value ? '自動核准' : '需要同意'}`);
            }
            writeIdeSettings(settings);
            return;
        }

        // === /yolo — enable all auto-approve ===
        if (text === '/yolo') {
            const settings = readIdeSettings();
            settings[APPROVE_KEYS.all] = true;
            settings[APPROVE_KEYS.edits] = true;
            settings[APPROVE_KEYS.terminal] = true;
            settings[APPROVE_KEYS.urls] = true;
            writeIdeSettings(settings);
            bot.sendMessage(chatId, '⚠️ YOLO MODE ON\n所有操作自動核准，AI 完全自主運作。\n用 /safe 回到安全模式。');
            return;
        }

        // === /safe — disable all auto-approve ===
        if (text === '/safe') {
            const settings = readIdeSettings();
            delete settings[APPROVE_KEYS.all];
            settings[APPROVE_KEYS.edits] = false;
            settings[APPROVE_KEYS.terminal] = false;
            settings[APPROVE_KEYS.urls] = false;
            writeIdeSettings(settings);
            bot.sendMessage(chatId, '🔒 安全模式\n所有操作都需要在 IDE 手動核准。');
            return;
        }

        if (text === '/newchat') {
            rpc.resetCascade();
            clearSession();
            bot.sendMessage(chatId, '🔄 New conversation started.');
            return;
        }

        if (text === '/reconnect') {
            bot.sendMessage(chatId, 'Reconnecting...');
            const conn = await reconnectFn();
            if (conn) {
                rpc.updateConnection(conn);
                rpc.resetCascade();
                bot.sendMessage(chatId, 'Reconnected!');
            } else {
                bot.sendMessage(chatId, 'Failed. Is Antigravity running?');
            }
            return;
        }

        // === /menu — show inline button menu ===
        // TODO: inline keyboard 暫時停用，待修復
        // if (text === '/menu') {
        //     bot.sendMessage(chatId, '📋 快捷選單：', menuKeyboard);
        //     return;
        // }

        // === /schedule — manage scheduled messages ===
        if (text === '/schedule' || text.startsWith('/schedule ')) {
            const parts = text.split(' ');
            const subCmd = parts[1];

            if (!subCmd || subCmd === 'list') {
                const schedules = loadSchedules();
                if (schedules.length === 0) {
                    bot.sendMessage(chatId, '📅 目前沒有排程。\n\n用法: /schedule add HH:MM 訊息\n例如: /schedule add 09:00 早安，今天有什麼計劃？');
                } else {
                    const lines = schedules.map(s =>
                        `${s.enabled ? '✅' : '⏸'} #${s.id} — ${s.time} — ${s.message.substring(0, 40)}`
                    );
                    bot.sendMessage(chatId, ['📅 排程列表：', '', ...lines, '', '刪除: /schedule remove <id>'].join('\n'));
                }
                return;
            }

            if (subCmd === 'add') {
                const time = parts[2]; // HH:MM
                const message = parts.slice(3).join(' ');
                if (!time || !message || !/^\d{2}:\d{2}$/.test(time)) {
                    bot.sendMessage(chatId, '❌ 用法: /schedule add HH:MM 訊息\n例如: /schedule add 09:00 早安，今天有什麼計劃？');
                    return;
                }
                const schedule = addSchedule({ time, message, chatId });
                bot.sendMessage(chatId, `✅ 排程已新增！\n#${schedule.id} — 每天 ${time}\n💬 ${message}`);
                return;
            }

            if (subCmd === 'remove' || subCmd === 'del') {
                const id = parseInt(parts[2], 10);
                if (!id) {
                    bot.sendMessage(chatId, '❌ 用法: /schedule remove <id>');
                    return;
                }
                const ok = removeSchedule(id);
                bot.sendMessage(chatId, ok ? `✅ 排程 #${id} 已刪除。` : `❌ 找不到排程 #${id}`);
                return;
            }

            bot.sendMessage(chatId, '❌ 未知子命令。\n用法: /schedule [list|add|remove]');
            return;
        }

        // === /pin — manage standing context pins ===
        if (text === '/pin' || text.startsWith('/pin ')) {
            const args = text.substring(4).trim();

            if (!args) {
                // List all pins
                const pins = loadPins();
                if (pins.length === 0) {
                    bot.sendMessage(chatId, '📌 目前沒有釘選。\n\n用法: /pin add 文字\n例如: /pin add 我住台北');
                } else {
                    const lines = pins.map(p => `#${p.id} — ${p.text}`);
                    bot.sendMessage(chatId, ['📌 釘選列表（每次對話都會注入 AI）：', '', ...lines, '', '新增: /pin add 文字', '刪除: /pin remove <id>', '清除: /pin clear'].join('\n'));
                }
                return;
            }

            if (args.startsWith('add ')) {
                const pinText = args.substring(4).trim();
                if (!pinText) {
                    bot.sendMessage(chatId, '❌ 用法: /pin add 文字');
                    return;
                }
                const result = addPin(pinText);
                if (result.ok) {
                    bot.sendMessage(chatId, `📌 已釘選 #${result.pin.id}：${result.pin.text}`);
                } else {
                    bot.sendMessage(chatId, `❌ ${result.error}`);
                }
                return;
            }

            if (args.startsWith('remove ') || args.startsWith('del ')) {
                const id = parseInt(args.split(' ')[1], 10);
                if (!id) {
                    bot.sendMessage(chatId, '❌ 用法: /pin remove <id>');
                    return;
                }
                const ok = removePin(id);
                bot.sendMessage(chatId, ok ? `✅ 釘選 #${id} 已刪除` : `❌ 找不到釘選 #${id}`);
                return;
            }

            if (args === 'clear') {
                clearPins();
                bot.sendMessage(chatId, '✅ 所有釘選已清除');
                return;
            }

            bot.sendMessage(chatId, '❌ 未知指令。\n用法: /pin [add|remove|clear]');
            return;
        }

        // === /note — manage knowledge base notes ===
        if (text === '/note' || text.startsWith('/note ')) {
            const args = text.substring(5).trim();

            if (!args) {
                // List all notes (titles only)
                const notes = loadNotes();
                if (notes.length === 0) {
                    bot.sendMessage(chatId, '📝 目前沒有筆記。\n\n用法: /note add [tag1,tag2] 內容\n例如: /note add [偏好,食物] 我喜歡吃拉麵');
                } else {
                    const lines = notes.map(n => {
                        const tags = n.tags.length > 0 ? ` [${n.tags.join(',')}]` : '';
                        const preview = n.content.length > 50 ? n.content.substring(0, 50) + '...' : n.content;
                        const src = n.source === 'ai' ? ' 🤖' : '';
                        return `#${n.id}${tags}${src} — ${preview}`;
                    });
                    bot.sendMessage(chatId, ['📝 筆記列表：', '', ...lines, '', '新增: /note add [tags] 內容', '搜尋: /note search 關鍵字', '刪除: /note remove <id>'].join('\n'));
                }
                return;
            }

            if (args.startsWith('add ')) {
                let content = args.substring(4).trim();
                let tags = [];

                // Parse optional [tags]
                const tagMatch = content.match(/^\[([^\]]*)\]\s*/);
                if (tagMatch) {
                    tags = tagMatch[1].split(',').map(t => t.trim()).filter(Boolean);
                    content = content.substring(tagMatch[0].length).trim();
                }

                if (!content) {
                    bot.sendMessage(chatId, '❌ 用法: /note add [tag1,tag2] 內容');
                    return;
                }

                const result = addNote({ content, tags, source: 'user' });
                if (result.ok) {
                    const tagStr = result.note.tags.length > 0 ? ` [${result.note.tags.join(',')}]` : '';
                    bot.sendMessage(chatId, `📝 筆記 #${result.note.id}${tagStr} 已儲存：${result.note.content}`);
                } else {
                    bot.sendMessage(chatId, `❌ ${result.error}`);
                }
                return;
            }

            if (args.startsWith('remove ') || args.startsWith('del ')) {
                const id = parseInt(args.split(' ')[1], 10);
                if (!id) {
                    bot.sendMessage(chatId, '❌ 用法: /note remove <id>');
                    return;
                }
                const ok = removeNote(id);
                bot.sendMessage(chatId, ok ? `✅ 筆記 #${id} 已刪除` : `❌ 找不到筆記 #${id}`);
                return;
            }

            if (args.startsWith('search ')) {
                const keyword = args.substring(7).trim();
                if (!keyword) {
                    bot.sendMessage(chatId, '❌ 用法: /note search 關鍵字');
                    return;
                }
                const results = searchNotes(keyword);
                if (results.length === 0) {
                    bot.sendMessage(chatId, `🔍 找不到含「${keyword}」的筆記。`);
                } else {
                    const lines = results.map(n => {
                        const tags = n.tags.length > 0 ? ` [${n.tags.join(',')}]` : '';
                        return `#${n.id}${tags} — ${n.content}`;
                    });
                    bot.sendMessage(chatId, [`🔍 搜尋「${keyword}」：`, '', ...lines].join('\n'));
                }
                return;
            }

            bot.sendMessage(chatId, '❌ 未知指令。\n用法: /note [add|remove|search]');
            return;
        }

        // === /recall — search conversation history ===
        if (text.startsWith('/recall ')) {
            const keyword = text.substring(8).trim();
            if (!keyword) {
                bot.sendMessage(chatId, '❌ 用法: /recall 關鍵字');
                return;
            }
            const results = searchHistory(keyword, 5);
            if (results.length === 0) {
                bot.sendMessage(chatId, `🔍 歷史中找不到「${keyword}」。`);
            } else {
                const lines = results.map(e => {
                    const role = e.role === 'user' ? '👤' : '🤖';
                    const time = e.ts ? e.ts.substring(5, 16).replace('T', ' ') : '';
                    const preview = e.text.length > 100 ? e.text.substring(0, 100) + '...' : e.text;
                    return `${role} ${time}\n${preview}`;
                });
                bot.sendMessage(chatId, [`🔍 歷史搜尋「${keyword}」（${results.length} 筆）：`, '', ...lines].join('\n\n'));
            }
            return;
        }

        // === /memory — memory overview ===
        if (text === '/memory') {
            const summary = getMemorySummary();
            bot.sendMessage(chatId, [
                '🧠 記憶總覽',
                '',
                `📌 釘選: ${summary.pins.count}/${summary.pins.max}`,
                `📝 筆記: ${summary.notes.count}/${summary.notes.max}`,
                `💬 歷史: ${summary.history.count} 則`,
                '',
                '── 指令 ──',
                '/pin — 管理釘選（常駐注入 AI）',
                '/note — 管理筆記（關鍵字匹配注入）',
                '/recall 關鍵字 — 搜尋歷史對話',
            ].join('\n'));
            return;
        }

        // === /cancel — cancel current AI execution ===
        if (text === '/cancel') {
            if (!rpc.currentCascade) {
                bot.sendMessage(chatId, '❌ 沒有進行中的對話。');
                return;
            }
            const ok = await rpc.cancelCascade();
            bot.sendMessage(chatId, ok ? '⛔ AI 執行已取消。' : '❌ 取消失敗，可能已經完成。');
            return;
        }

        // === /model — switch AI model ===
        if (text === '/model') {
            // 真實模型 ID（從 Language Server binary + IDE 模型選單比對）
            const models = [
                { text: '⭐ Gemini 3.1 Pro',       id: 'MODEL_GOOGLE_GEMINI_2_5_PRO' },
                { text: 'Gemini 3.1 Pro (Low)',    id: 'MODEL_GOOGLE_GEMINI_2_5_PRO_LOW' },
                { text: 'Gemini 3 Flash',           id: 'MODEL_PLACEHOLDER_M18' },
                { text: 'Claude Sonnet 4.6',        id: 'MODEL_CLAUDE_4_SONNET_THINKING' },
                { text: 'Claude Opus 4.6',          id: 'MODEL_CLAUDE_4_OPUS_THINKING' },
                { text: 'GPT-OSS 120B',             id: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM' },
            ];
            const rows = [];
            for (let i = 0; i < models.length; i += 2) {
                const row = models.slice(i, i + 2).map(m => ({
                    text: m.text + (config.model === m.id ? ' ✓' : ''),
                    callback_data: `model_${m.id}`,
                }));
                rows.push(row);
            }
            bot.sendMessage(chatId, `🤖 目前模型: ${config.model}\n選擇新模型：`, {
                reply_markup: { inline_keyboard: rows },
            });
            return;
        }

        if (text.startsWith('/model ')) {
            const newModel = text.substring(7).trim();
            if (newModel) {
                config.model = newModel;
                bot.sendMessage(chatId, `🤖 模型已切換為: ${newModel}`);
            }
            return;
        }

        // === /cascades — list all conversations ===
        if (text === '/cascades') {
            const summaries = await rpc.listCascades();
            const entries = Object.entries(summaries);
            if (entries.length === 0) {
                bot.sendMessage(chatId, '📋 沒有對話記錄。');
                return;
            }
            const lines = entries.slice(0, 10).map(([id, info]) => {
                const current = id === rpc.currentCascade ? ' ← 目前' : '';
                const title = info?.title || info?.firstMessage?.substring(0, 40) || '(no title)';
                return `• ${id.substring(0, 8)}... ${title}${current}`;
            });
            bot.sendMessage(chatId, ['📋 對話列表：', '', ...lines, '', `共 ${entries.length} 個對話`].join('\n'));
            return;
        }

        if (text.startsWith('/')) return;

        // === Handle files: download and build message for AI ===
        const fileInfo = await extractFileInfo(msg);
        let messageForAI = text;
        let mediaItems = null;  // For inline image data via media field

        if (fileInfo) {
            // Determine the best way to handle this file:
            // 1. Inline media (images, audio, PDF) → send via media field for direct AI recognition
            // 2. Other files (txt, code, etc.) → download and pass path for AI to read via VIEW_FILE
            // 3. Unsupported (video, sticker) → show not-supported message

            const inlineMime = getInlineMediaMimeType(fileInfo.ext);
            const isStaticSticker = fileInfo.type === 'sticker' && fileInfo.ext === '.webp';
            const isInlineType = fileInfo.type === 'photo'
                || isStaticSticker
                || (fileInfo.type === 'document' && inlineMime && !inlineMime.startsWith('audio/'));
            const UNSUPPORTED_TYPES = ['video'];

            const isAudioType = fileInfo.type === 'voice' || fileInfo.type === 'audio';

            if (isAudioType) {
                // === VOICE/AUDIO: transcribe with Whisper STT, send text to AI ===
                try {
                    const localPath = await downloadTgFile(fileInfo);
                    const fileSize = readFileSync(localPath).length;
                    console.log(`  🎤 Audio received: ${fileInfo.ext}, ${fileSize} bytes`);

                    // Convert OGG to WAV if needed (whisper handles most formats, but WAV is safest)
                    let audioForWhisper = localPath;
                    if (fileInfo.ext === '.ogg' || fileInfo.ext === '.oga') {
                        const wavPath = localPath.replace(/\.[^.]+$/, '.wav');
                        try {
                            await execFileAsync('ffmpeg', ['-i', localPath, '-ar', '16000', '-ac', '1', '-y', wavPath], { timeout: 30000 });
                            audioForWhisper = wavPath;
                        } catch (ffErr) {
                            console.log(`  ffmpeg convert failed, using original: ${ffErr.message}`);
                        }
                    }

                    console.log(`  🔄 Transcribing with Whisper (${WHISPER_MODEL})...`);
                    const sttMsg = await bot.sendMessage(chatId, '🔄 語音辨識中...');
                    const transcription = await transcribeAudio(audioForWhisper);

                    try { await bot.deleteMessage(chatId, sttMsg.message_id); } catch {}

                    if (transcription) {
                        console.log(`  ✅ STT: "${transcription.substring(0, 80)}"`);
                        // Prepend transcription to any existing caption
                        const sttPrefix = `[語音訊息內容] ${transcription}`;
                        messageForAI = messageForAI
                            ? `${sttPrefix}\n\n${messageForAI}`
                            : sttPrefix;
                    } else {
                        console.log(`  ⚠ STT: no transcription result`);
                        await bot.sendMessage(chatId, '⚠ 無法辨識語音內容，請用文字重新輸入。');
                        if (!messageForAI) return;
                    }
                } catch (dlErr) {
                    console.error(`  Audio/STT error: ${dlErr.message}`);
                    bot.sendMessage(chatId, `⚠ 語音處理失敗: ${dlErr.message}`);
                    if (!messageForAI) return;
                }
            } else if (isInlineType) {
                // === INLINE MEDIA: image or PDF → send as base64 via media field ===
                try {
                    const localPath = await downloadTgFile(fileInfo);
                    const fileBuffer = readFileSync(localPath);
                    const base64Data = fileBuffer.toString('base64');
                    const mimeType = inlineMime || 'image/jpeg';

                    mediaItems = [{
                        mimeType,
                        inlineData: base64Data,
                    }];

                    const icon = mimeType === 'application/pdf' ? '📄' : '📷';
                    console.log(`  ${icon} Media ready: ${mimeType}, ${fileBuffer.length} bytes`);

                    // If no text caption, add a default prompt based on type
                    if (!messageForAI) {
                        if (mimeType === 'application/pdf') {
                            messageForAI = '請閱讀這份 PDF 檔案並說明內容。';
                        } else {
                            messageForAI = '請描述這張圖片的內容。';
                        }
                    }
                } catch (dlErr) {
                    console.error(`  Media download error: ${dlErr.message}`);
                    bot.sendMessage(chatId, `⚠ 下載失敗: ${dlErr.message}`);
                    if (!messageForAI) return;
                }
            } else if (fileInfo.type === 'sticker' && fileInfo.ext !== '.webp') {
                // === Animated/video sticker: not supported ===
                console.log(`  Skipped animated/video sticker (${fileInfo.ext})`);
                bot.sendMessage(chatId, '⚠ 動態/影片貼圖無法辨識，僅支援靜態貼圖。');
                if (!messageForAI) return;
            } else if (UNSUPPORTED_TYPES.includes(fileInfo.type)) {
                // === UNSUPPORTED: video ===
                console.log(`  Skipped unsupported ${fileInfo.type}`);
                bot.sendMessage(chatId, '⚠ 目前不支援影片。\n請用文字描述內容。');
                if (!messageForAI) return;
            } else {
                // === OTHER FILES (txt, code, etc.): download and pass path ===
                try {
                    const localPath = await downloadTgFile(fileInfo);
                    console.log(`  📄 Downloaded ${fileInfo.type}: ${localPath}`);
                    const fileNote = `[User sent a ${fileInfo.type} file, saved to: ${localPath}]`;
                    messageForAI = messageForAI
                        ? `${fileNote}\n${messageForAI}`
                        : fileNote;
                } catch (dlErr) {
                    console.error(`  File download error: ${dlErr.message}`);
                    bot.sendMessage(chatId, `⚠ 檔案下載失敗: ${dlErr.message}`);
                    if (!messageForAI) return;
                }
            }
        }

        // Skip if no text and no file
        if (!messageForAI) return;

        // === AI message → queue ===
        if (!rpc.connected) {
            bot.sendMessage(chatId, 'Not connected. Use /reconnect');
            return;
        }

        // Build memory context for this message
        const memoryContext = buildMemoryContext(messageForAI);
        if (memoryContext) {
            console.log(`  💾 Memory: ${memoryContext.split('\n').length} lines injected`);
        }

        queue.push({ chatId, text: messageForAI, firstName: msg.from.first_name, mediaItems, memoryContext });

        if (queue.length > 1) {
            bot.sendMessage(chatId, `Queued (${queue.length - 1} ahead)`);
        }

        processQueue();
    });

    // === Inline button callback handler ===
    bot.on('callback_query', async (query) => {
        console.log(`  🔘 Callback: ${query.data} from ${query.from.id}`);
        const chatId = query.message.chat.id;
        const userId = String(query.from.id);
        if (config.allowedUsers && !config.allowedUsers.includes(userId)) {
            console.log(`  ⛔ Unauthorized callback from ${userId}`);
            bot.answerCallbackQuery(query.id, { text: '⛔ 未授權' });
            return;
        }

        const action = query.data;
        bot.answerCallbackQuery(query.id).catch(() => {}); // Dismiss loading indicator

        // === Permission inline buttons: pa_* (allow) / pd_* (deny) ===
        if (action.startsWith('pa_') || action.startsWith('pd_')) {
            // Format: pa_{trajectoryId}_{stepIndex}_{typeAbbr}
            //         pd_{trajectoryId}_{stepIndex}_{typeAbbr}
            const allow = action.startsWith('pa_');
            const rest = action.substring(3); // strip pa_ or pd_
            const lastUnderscore = rest.lastIndexOf('_');
            const secondLast = rest.lastIndexOf('_', lastUnderscore - 1);

            const typeAbbr = rest.substring(lastUnderscore + 1); // cmd, file, br, mcp
            const stepIndex = parseInt(rest.substring(secondLast + 1, lastUnderscore), 10);
            const trajectoryId = rest.substring(0, secondLast);

            // Map abbreviation back to full type
            const abbrToType = { cmd: 'run_command', file: 'file', br: 'browser', mcp: 'mcp' };
            const type = abbrToType[typeAbbr] || 'browser';

            const ok = await rpc.handlePermission(trajectoryId, stepIndex, type, allow);
            const emoji = allow ? '✅' : '❌';
            const typeLabel = type === 'run_command' ? '指令' : type === 'file' ? '檔案' : type === 'mcp' ? 'MCP' : '瀏覽器';

            // Edit the permission message to show result
            try {
                await bot.editMessageText(`${emoji} ${typeLabel}已${allow ? '允許' : '拒絕'}`, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
            } catch {}
            return;
        }

        // === Model selection inline buttons: model_* ===
        if (action.startsWith('model_')) {
            const newModel = action.substring(6); // strip 'model_'
            config.model = newModel;
            try {
                await bot.editMessageText(`🤖 模型已切換為: ${newModel}`, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
            } catch {}
            return;
        }

        switch (action) {
            case 'newchat':
                rpc.resetCascade();
                clearSession();
                bot.sendMessage(chatId, '🔄 New conversation started.');
                break;

            case 'status': {
                const settings = readIdeSettings();
                const history = loadHistory();
                const approveStatus = Object.entries(APPROVE_KEYS)
                    .map(([name, key]) => `  ${name}: ${settings[key] ? '✅ 自動' : '🔒 要問'}`)
                    .join('\n');
                bot.sendMessage(chatId, [
                    'Bridge Status:',
                    `Connected: ${rpc.connected ? 'Yes' : 'No'}`,
                    `Model: ${config.model}`,
                    `Cascade: ${rpc.currentCascade?.substring(0, 8) || '(none)'}`,
                    `Queue: ${queue.length} pending`,
                    `Processing: ${processing ? 'Yes' : 'No'}`,
                    `History: ${history.length} messages`,
                    '',
                    'Auto-Approve:',
                    approveStatus,
                ].join('\n'));
                break;
            }

            case 'reconnect': {
                bot.sendMessage(chatId, 'Reconnecting...');
                const conn = await reconnectFn();
                if (conn) {
                    rpc.updateConnection(conn);
                    rpc.resetCascade();
                    bot.sendMessage(chatId, 'Reconnected!');
                } else {
                    bot.sendMessage(chatId, 'Failed. Is Antigravity running?');
                }
                break;
            }

            case 'yolo': {
                const settings = readIdeSettings();
                settings[APPROVE_KEYS.all] = true;
                settings[APPROVE_KEYS.edits] = true;
                settings[APPROVE_KEYS.terminal] = true;
                settings[APPROVE_KEYS.urls] = true;
                writeIdeSettings(settings);
                bot.sendMessage(chatId, '⚠️ YOLO MODE ON\n所有操作自動核准。');
                break;
            }

            case 'safe': {
                const settings = readIdeSettings();
                delete settings[APPROVE_KEYS.all];
                settings[APPROVE_KEYS.edits] = false;
                settings[APPROVE_KEYS.terminal] = false;
                settings[APPROVE_KEYS.urls] = false;
                writeIdeSettings(settings);
                bot.sendMessage(chatId, '🔒 安全模式已啟用。');
                break;
            }

            case 'schedule': {
                const schedules = loadSchedules();
                if (schedules.length === 0) {
                    bot.sendMessage(chatId, '📅 目前沒有排程。\n\n用法: /schedule add HH:MM 訊息');
                } else {
                    const lines = schedules.map(s =>
                        `${s.enabled ? '✅' : '⏸'} #${s.id} — ${s.time} — ${s.message.substring(0, 40)}`
                    );
                    bot.sendMessage(chatId, ['📅 排程列表：', '', ...lines, '', '刪除: /schedule remove <id>'].join('\n'));
                }
                break;
            }

            case 'cancel_ai': {
                if (!rpc.currentCascade) {
                    bot.sendMessage(chatId, '❌ 沒有進行中的對話。');
                    break;
                }
                const ok = await rpc.cancelCascade();
                bot.sendMessage(chatId, ok ? '⛔ AI 執行已取消。' : '❌ 取消失敗。');
                break;
            }
        }
    });

    // Handle polling errors gracefully
    bot.on('polling_error', (err) => {
        console.error(`  TG polling error: ${err.message}`);
    });

    // === Watchdog: periodic health check + auto-reconnect (every 30s) ===
    // Notifies twice on disconnect: immediately + 5 min later, then silent
    let wasHealthy = rpc.connected;
    let disconnectCount = 0;       // How many disconnect notifications sent
    let disconnectFirstAt = 0;     // Timestamp of first disconnect
    setInterval(async () => {
        const ok = rpc.connected ? await rpc.healthCheck() : false;

        if (ok) {
            if (!wasHealthy) {
                console.log('  ✅ Watchdog: connection restored');
                if (lastKnownChatId) {
                    bot.sendMessage(lastKnownChatId, '✅ IDE 連線已恢復！').catch(() => {});
                }
                disconnectCount = 0;
                disconnectFirstAt = 0;
            }
            wasHealthy = true;
        } else {
            const now = Date.now();

            // First notification: immediate
            if (wasHealthy && disconnectCount === 0) {
                console.log('  ⚠ Watchdog: connection lost');
                if (lastKnownChatId) {
                    bot.sendMessage(lastKnownChatId, '⚠ IDE 連線中斷。開啟 Antigravity 後會自動重連。').catch(() => {});
                }
                disconnectCount = 1;
                disconnectFirstAt = now;
            }

            // Second notification: 5 minutes later
            if (disconnectCount === 1 && disconnectFirstAt > 0 && now - disconnectFirstAt >= 300000) {
                if (lastKnownChatId) {
                    bot.sendMessage(lastKnownChatId, '⚠ IDE 仍未連線。請確認 Antigravity 是否在執行。').catch(() => {});
                }
                disconnectCount = 2; // No more notifications
            }

            wasHealthy = false;

            // Silently try to reconnect
            const conn = await reconnectFn();
            if (conn) {
                rpc.updateConnection(conn);
                const verify = await rpc.healthCheck();
                if (verify) {
                    wasHealthy = true;
                    disconnectCount = 0;
                    disconnectFirstAt = 0;
                    console.log('  ✅ Watchdog: reconnected');
                    if (lastKnownChatId) {
                        bot.sendMessage(lastKnownChatId, '✅ IDE 已重新連線！').catch(() => {});
                    }
                }
            }
        }
    }, 30000);

    // === Scheduler: check every 60s for triggered schedules ===
    let lastScheduleMinute = -1; // Prevent duplicate triggers within same minute
    setInterval(async () => {
        const now = new Date();
        const currentMinute = now.getHours() * 60 + now.getMinutes();
        if (currentMinute === lastScheduleMinute) return; // Already checked this minute

        const triggered = getTriggeredSchedules();
        if (triggered.length > 0) {
            lastScheduleMinute = currentMinute;
        }

        for (const sched of triggered) {
            const chatId = sched.chatId;
            if (!chatId || !rpc.connected) continue;

            console.log(`  📅 Scheduler triggered: #${sched.id} "${sched.message.substring(0, 40)}"`);
            bot.sendMessage(chatId, `📅 排程 #${sched.id} 觸發中...\n💬 「${sched.message}」`).catch(() => {});

            queue.push({
                chatId,
                text: sched.message,
                firstName: 'Scheduler',
                mediaItems: null,
                memoryContext: buildMemoryContext(sched.message),
            });
            processQueue();
        }
    }, 15000); // Check every 15s to minimize miss window

    process.on('SIGINT', () => {
        console.log('\nShutting down...');
        bot.stopPolling();
        process.exit(0);
    });

    return bot;
}
