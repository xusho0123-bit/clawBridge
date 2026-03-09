// lib/telegram/callbacks.js — Inline button callback 處理
// 權限按鈕、模型選擇、快捷選單

import { clearSession, loadHistory } from '../history.js';
import { loadSchedules } from '../scheduler.js';
import { readIdeSettings, writeIdeSettings, APPROVE_KEYS } from './settings.js';

export function setupCallbacks(ctx) {
    const { bot, config, rpc, reconnectFn } = ctx;

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
        bot.answerCallbackQuery(query.id).catch(() => {});

        // === Permission inline buttons: pa_* (allow) / pd_* (deny) ===
        if (action.startsWith('pa_') || action.startsWith('pd_')) {
            const allow = action.startsWith('pa_');
            const rest = action.substring(3);
            const lastUnderscore = rest.lastIndexOf('_');
            const secondLast = rest.lastIndexOf('_', lastUnderscore - 1);

            const typeAbbr = rest.substring(lastUnderscore + 1);
            const stepIndex = parseInt(rest.substring(secondLast + 1, lastUnderscore), 10);
            const trajectoryId = rest.substring(0, secondLast);

            const abbrToType = { cmd: 'run_command', file: 'file', br: 'browser', mcp: 'mcp' };
            const type = abbrToType[typeAbbr] || 'browser';

            const ok = await rpc.handlePermission(trajectoryId, stepIndex, type, allow);
            const emoji = allow ? '✅' : '❌';
            const typeLabel = type === 'run_command' ? '指令' : type === 'file' ? '檔案' : type === 'mcp' ? 'MCP' : '瀏覽器';

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
            const newModel = action.substring(6);
            config.model = newModel;
            try {
                await bot.editMessageText(`🤖 模型已切換為: ${newModel}`, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                });
            } catch {}
            return;
        }

        // === Menu quick actions ===
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
                    `Queue: ${ctx.queue.length} pending`,
                    `Processing: ${ctx.processing ? 'Yes' : 'No'}`,
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
}
