// lib/telegram/queue.js — 訊息佇列 + AI 互動
// processQueue、streaming callback、錯誤處理、stuck detection

import { existsSync, createReadStream } from 'fs';
import { saveSession, appendHistory } from '../history.js';
import { addNote, searchHistory, extractMemoryMarkers } from '../memory.js';
import { readIdeSettings, APPROVE_KEYS } from './settings.js';
import { extractMedia, getMediaType } from './media.js';

export function setupQueue(ctx) {
    const { bot, config, rpc, reconnectFn } = ctx;

    async function processQueue() {
        if (ctx.processing || ctx.queue.length === 0) return;
        ctx.processing = true;
        ctx.processingStartedAt = Date.now();

        const { chatId, text, firstName, mediaItems, memoryContext } = ctx.queue.shift();

        console.log(`  TG [${firstName}]: "${text.substring(0, 60)}"`);
        let statusMsg;
        try {
            bot.sendChatAction(chatId, 'typing').catch(() => {});
            statusMsg = await bot.sendMessage(chatId, '⏳ 思考中...');
        } catch {
            ctx.processing = false;
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
                if (now - lastEditTime < 300) return; // 300ms throttle
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
                const typeAbbr = { run_command: 'cmd', file: 'file', browser: 'br', mcp: 'mcp' };
                const abbr = typeAbbr[info.type] || 'br';

                const label = info.type === 'run_command' ? `🖥 ${info.cmd || 'command'}`
                    : info.type === 'file' ? `📝 ${info.path || 'file'}`
                    : info.type === 'mcp' ? '🔌 MCP tool'
                    : '🌐 Browser action';

                // TG callback_data 上限 64 bytes，截斷 trajectoryId
                const tidShort = (info.trajectoryId || '').substring(0, 36);
                bot.sendMessage(chatId, `⚠️ AI 需要權限：${label}`, {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ Allow', callback_data: `pa_${tidShort}_${info.stepIndex}_${abbr}` },
                            { text: '❌ Deny', callback_data: `pd_${tidShort}_${info.stepIndex}_${abbr}` },
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

            for (const rem of memoryResult.remembers) {
                const result = addNote({ content: rem.content, tags: rem.tags, source: 'ai' });
                if (result.ok) {
                    console.log(`  🧠 AI remembered: #${result.note.id} "${rem.content.substring(0, 40)}"`);
                }
            }

            for (const keyword of memoryResult.recalls) {
                const found = searchHistory(keyword, 3);
                if (found.length > 0) {
                    console.log(`  🔍 AI recall "${keyword}": ${found.length} results (logged only)`);
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

            // Save to history
            appendHistory('user', text);
            const historyText = (cleanText || response).replace(/\n*\[歷史回顧\][\s\S]*?(?=\n\n|\n*$)/g, '').trim();
            appendHistory('ai', historyText || cleanText || response);

            // Save session state
            const state = rpc.getState();
            if (state.cascadeId) saveSession({ cascadeId: state.cascadeId });
        } catch (err) {
            console.error(`  Error: ${err.message}`);
            try { await bot.deleteMessage(chatId, statusMsg.message_id); } catch { }

            // /cancel 觸發的取消 — 已經回覆用戶了，靜默處理
            if (err.message === 'Cancelled') {
                console.log('  Cancelled by user, skipping error handler');
            } else if (err.message.includes('ECONNREFUSED') || err.message.includes('request:')) {
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

        ctx.processing = false;
        ctx.processingStartedAt = 0;
        processQueue(); // Process next in queue
    }

    // 掛到 ctx 上，讓其他模組能呼叫
    ctx.processQueue = processQueue;

    // Safety: unstick the queue if processing hangs for too long
    const stuckTimeout = config.pollTimeout + 60000;
    setInterval(() => {
        if (ctx.processing && ctx.processingStartedAt > 0
            && Date.now() - ctx.processingStartedAt > stuckTimeout) {
            console.error(`  Queue stuck for ${Math.round(stuckTimeout/1000)}s, force-resetting...`);
            ctx.processing = false;
            ctx.processingStartedAt = 0;
            rpc.resetCascade();
            processQueue();
        }
    }, 10000);
}
