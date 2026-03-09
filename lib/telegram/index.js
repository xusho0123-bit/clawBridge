// lib/telegram/index.js — Telegram Bot 入口
// 組裝所有模組，export startTelegramBot

import TelegramBot from 'node-telegram-bot-api';
import { readFileSync, unlinkSync } from 'fs';
import { buildMemoryContext } from '../memory.js';
import { getTriggeredSchedules } from '../scheduler.js';
import { createContext } from './ctx.js';
import { setupQueue } from './queue.js';
import { setupCommands } from './commands.js';
import { setupCallbacks } from './callbacks.js';
import { setupWatchdog } from './watchdog.js';
import {
    extractFileInfo, downloadTgFile, getInlineMediaMimeType,
    transcribeAudio, WHISPER_MODEL, DOWNLOAD_DIR, execFileAsync,
} from './media.js';

export function startTelegramBot(config, rpc, reconnectFn) {
    const bot = new TelegramBot(config.tgToken, { polling: true });
    const ctx = createContext(bot, config, rpc, reconnectFn);

    // 註冊 TG Bot 指令選單
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

    // 初始化各模組
    setupQueue(ctx);
    const handleCommand = setupCommands(ctx);
    setupCallbacks(ctx);
    setupWatchdog(ctx);

    console.log('  Telegram bot started (polling)');

    // ============================================================
    //  Message handler
    // ============================================================

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userId = String(msg.from.id);
        console.log(`  📩 TG message from ${userId}: ${(msg.text || '').substring(0, 50)}`);
        if (config.allowedUsers && !config.allowedUsers.includes(userId)) {
            console.log(`  ⛔ User ${userId} not in allowedUsers`);
            return;
        }
        ctx.lastKnownChatId = chatId;

        const text = msg.text || msg.caption || '';

        // 指令處理（不進佇列）
        if (await handleCommand(chatId, text)) return;

        // === Handle files: download and build message for AI ===
        const fileInfo = await extractFileInfo(msg);
        let messageForAI = text;
        let mediaItems = null;

        if (fileInfo) {
            const inlineMime = getInlineMediaMimeType(fileInfo.ext);
            const isStaticSticker = fileInfo.type === 'sticker' && fileInfo.ext === '.webp';
            const isInlineType = fileInfo.type === 'photo'
                || isStaticSticker
                || (fileInfo.type === 'document' && inlineMime && !inlineMime.startsWith('audio/'));
            const UNSUPPORTED_TYPES = ['video'];
            const isAudioType = fileInfo.type === 'voice' || fileInfo.type === 'audio';

            if (isAudioType) {
                // === VOICE/AUDIO: transcribe with Whisper STT ===
                try {
                    const localPath = await downloadTgFile(bot, config, fileInfo);
                    const fileSize = readFileSync(localPath).length;
                    console.log(`  🎤 Audio received: ${fileInfo.ext}, ${fileSize} bytes`);

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

                    // 清理音檔
                    try { unlinkSync(localPath); } catch {}
                    if (audioForWhisper !== localPath) {
                        try { unlinkSync(audioForWhisper); } catch {}
                    }

                    try { await bot.deleteMessage(chatId, sttMsg.message_id); } catch {}

                    if (transcription) {
                        console.log(`  ✅ STT: "${transcription.substring(0, 80)}"`);
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
                // === INLINE MEDIA: image or PDF → send as base64 ===
                try {
                    const localPath = await downloadTgFile(bot, config, fileInfo);
                    const fileBuffer = readFileSync(localPath);
                    const base64Data = fileBuffer.toString('base64');
                    const mimeType = inlineMime || 'image/jpeg';

                    mediaItems = [{
                        mimeType,
                        inlineData: base64Data,
                    }];

                    const icon = mimeType === 'application/pdf' ? '📄' : '📷';
                    console.log(`  ${icon} Media ready: ${mimeType}, ${fileBuffer.length} bytes`);

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
                console.log(`  Skipped animated/video sticker (${fileInfo.ext})`);
                bot.sendMessage(chatId, '⚠ 動態/影片貼圖無法辨識，僅支援靜態貼圖。');
                if (!messageForAI) return;
            } else if (UNSUPPORTED_TYPES.includes(fileInfo.type)) {
                console.log(`  Skipped unsupported ${fileInfo.type}`);
                bot.sendMessage(chatId, '⚠ 目前不支援影片。\n請用文字描述內容。');
                if (!messageForAI) return;
            } else {
                // === OTHER FILES: download and pass path ===
                try {
                    const localPath = await downloadTgFile(bot, config, fileInfo);
                    console.log(`  📄 Downloaded ${fileInfo.type}: ${localPath}`);
                    const fileNote = `[User sent a ${fileInfo.type} file, saved to: ${localPath}]`;
                    messageForAI = messageForAI
                        ? `${fileNote}\n${messageForAI}`
                        : fileNote;
                } catch (dlErr) {
                    console.error(`  File download error: ${dlErr.message}`);
                    bot.sendMessage(chatId, `⚠ 下載失敗: ${dlErr.message}`);
                    if (!messageForAI) return;
                }
            }
        }

        // === AI message → queue ===
        if (!rpc.connected) {
            bot.sendMessage(chatId, 'Not connected. Use /reconnect');
            return;
        }

        const memoryContext = buildMemoryContext(messageForAI);
        if (memoryContext) {
            console.log(`  💾 Memory: ${memoryContext.split('\n').length} lines injected`);
        }

        ctx.queue.push({ chatId, text: messageForAI, firstName: msg.from.first_name, mediaItems, memoryContext });

        if (ctx.queue.length > 1) {
            bot.sendMessage(chatId, `Queued (${ctx.queue.length - 1} ahead)`);
        }

        ctx.processQueue();
    });

    // Handle polling errors gracefully
    bot.on('polling_error', (err) => {
        console.error(`  TG polling error: ${err.message}`);
    });

    // === Scheduler: check every 15s for triggered schedules ===
    let lastScheduleMinute = -1;
    setInterval(async () => {
        const now = new Date();
        const currentMinute = now.getHours() * 60 + now.getMinutes();
        if (currentMinute === lastScheduleMinute) return;

        const triggered = getTriggeredSchedules();
        if (triggered.length > 0) {
            lastScheduleMinute = currentMinute;
        }

        for (const sched of triggered) {
            const schedChatId = sched.chatId;
            if (!schedChatId || !rpc.connected) continue;

            console.log(`  📅 Scheduler triggered: #${sched.id} "${sched.message.substring(0, 40)}"`);
            bot.sendMessage(schedChatId, `📅 排程 #${sched.id} 觸發中...\n💬 「${sched.message}」`).catch(() => {});

            ctx.queue.push({
                chatId: schedChatId,
                text: sched.message,
                firstName: 'Scheduler',
                mediaItems: null,
                memoryContext: buildMemoryContext(sched.message),
            });
            ctx.processQueue();
        }
    }, 15000);

    process.on('SIGINT', () => {
        console.log('\nShutting down...');
        bot.stopPolling();
        process.exit(0);
    });

    return bot;
}
