// lib/telegram/commands.js — 所有 /指令 處理
// /start /help /status /reconnect /newchat /approve /yolo /safe
// /schedule /pin /note /recall /memory /cancel /model /cascades

import { clearSession, loadHistory } from '../history.js';
import { loadSchedules, addSchedule, removeSchedule } from '../scheduler.js';
import {
    loadPins, addPin, removePin, clearPins,
    loadNotes, addNote, removeNote, searchNotes,
    searchHistory, getMemorySummary,
} from '../memory.js';
import { readIdeSettings, writeIdeSettings, APPROVE_KEYS } from './settings.js';

export function setupCommands(ctx) {
    const { bot, config, rpc, reconnectFn } = ctx;

    // 回傳 true 表示已處理（是指令），false 表示不是指令
    return async function handleCommand(chatId, text) {
        // === /start /help ===
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
            return true;
        }

        // === /status ===
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
                `Queue: ${ctx.queue.length} pending`,
                `Processing: ${ctx.processing ? 'Yes' : 'No'}`,
                '',
                `Memory: 📌${mem.pins.count} 📝${mem.notes.count} 💬${mem.history.count}`,
                '',
                'Auto-Approve:',
                approveStatus,
            ].join('\n'));
            return true;
        }

        // === /approve ===
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
            return true;
        }

        if (text.startsWith('/approve ')) {
            const parts = text.split(' ');
            const target = parts[1];
            const action = parts[2];
            if (!APPROVE_KEYS[target]) {
                bot.sendMessage(chatId, `❌ 未知類型: ${target}\n可用: edits, terminal, urls, all`);
                return true;
            }
            if (action !== 'on' && action !== 'off') {
                bot.sendMessage(chatId, '❌ 用法: /approve <類型> <on|off>');
                return true;
            }
            const settings = readIdeSettings();
            const value = action === 'on';
            if (target === 'all') {
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
            return true;
        }

        // === /yolo ===
        if (text === '/yolo') {
            const settings = readIdeSettings();
            settings[APPROVE_KEYS.all] = true;
            settings[APPROVE_KEYS.edits] = true;
            settings[APPROVE_KEYS.terminal] = true;
            settings[APPROVE_KEYS.urls] = true;
            writeIdeSettings(settings);
            bot.sendMessage(chatId, '⚠️ YOLO MODE ON\n所有操作自動核准，AI 完全自主運作。\n用 /safe 回到安全模式。');
            return true;
        }

        // === /safe ===
        if (text === '/safe') {
            const settings = readIdeSettings();
            delete settings[APPROVE_KEYS.all];
            settings[APPROVE_KEYS.edits] = false;
            settings[APPROVE_KEYS.terminal] = false;
            settings[APPROVE_KEYS.urls] = false;
            writeIdeSettings(settings);
            bot.sendMessage(chatId, '🔒 安全模式\nAI 執行操作前會在 Telegram 詢問，需要你按 ✅ Allow 才會執行。');
            return true;
        }

        // === /newchat ===
        if (text === '/newchat') {
            rpc.resetCascade();
            clearSession();
            bot.sendMessage(chatId, '🔄 New conversation started.');
            return true;
        }

        // === /reconnect ===
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
            return true;
        }

        // === /schedule ===
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
                return true;
            }

            if (subCmd === 'add') {
                const time = parts[2];
                const message = parts.slice(3).join(' ');
                if (!time || !message || !/^\d{2}:\d{2}$/.test(time)) {
                    bot.sendMessage(chatId, '❌ 用法: /schedule add HH:MM 訊息\n例如: /schedule add 09:00 早安，今天有什麼計劃？');
                    return true;
                }
                const schedule = addSchedule({ time, message, chatId });
                bot.sendMessage(chatId, `✅ 排程已新增！\n#${schedule.id} — 每天 ${time}\n💬 ${message}`);
                return true;
            }

            if (subCmd === 'remove' || subCmd === 'del') {
                const id = parseInt(parts[2], 10);
                if (!id) {
                    bot.sendMessage(chatId, '❌ 用法: /schedule remove <id>');
                    return true;
                }
                const ok = removeSchedule(id);
                bot.sendMessage(chatId, ok ? `✅ 排程 #${id} 已刪除。` : `❌ 找不到排程 #${id}`);
                return true;
            }

            bot.sendMessage(chatId, '❌ 未知子命令。\n用法: /schedule [list|add|remove]');
            return true;
        }

        // === /pin ===
        if (text === '/pin' || text.startsWith('/pin ')) {
            const args = text.substring(4).trim();

            if (!args) {
                const pins = loadPins();
                if (pins.length === 0) {
                    bot.sendMessage(chatId, '📌 目前沒有釘選。\n\n用法: /pin add 文字\n例如: /pin add 我住台北');
                } else {
                    const lines = pins.map(p => `#${p.id} — ${p.text}`);
                    bot.sendMessage(chatId, ['📌 釘選列表（每次對話都會注入 AI）：', '', ...lines, '', '新增: /pin add 文字', '刪除: /pin remove <id>', '清除: /pin clear'].join('\n'));
                }
                return true;
            }

            if (args.startsWith('add ')) {
                const pinText = args.substring(4).trim();
                if (!pinText) {
                    bot.sendMessage(chatId, '❌ 用法: /pin add 文字');
                    return true;
                }
                const result = addPin(pinText);
                if (result.ok) {
                    bot.sendMessage(chatId, `📌 已釘選 #${result.pin.id}：${result.pin.text}`);
                } else {
                    bot.sendMessage(chatId, `❌ ${result.error}`);
                }
                return true;
            }

            if (args.startsWith('remove ') || args.startsWith('del ')) {
                const id = parseInt(args.split(' ')[1], 10);
                if (!id) {
                    bot.sendMessage(chatId, '❌ 用法: /pin remove <id>');
                    return true;
                }
                const ok = removePin(id);
                bot.sendMessage(chatId, ok ? `✅ 釘選 #${id} 已刪除` : `❌ 找不到釘選 #${id}`);
                return true;
            }

            if (args === 'clear') {
                clearPins();
                bot.sendMessage(chatId, '✅ 所有釘選已清除');
                return true;
            }

            bot.sendMessage(chatId, '❌ 未知指令。\n用法: /pin [add|remove|clear]');
            return true;
        }

        // === /note ===
        if (text === '/note' || text.startsWith('/note ')) {
            const args = text.substring(5).trim();

            if (!args) {
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
                return true;
            }

            if (args.startsWith('add ')) {
                let content = args.substring(4).trim();
                let tags = [];
                const tagMatch = content.match(/^\[([^\]]*)\]\s*/);
                if (tagMatch) {
                    tags = tagMatch[1].split(',').map(t => t.trim()).filter(Boolean);
                    content = content.substring(tagMatch[0].length).trim();
                }
                if (!content) {
                    bot.sendMessage(chatId, '❌ 用法: /note add [tag1,tag2] 內容');
                    return true;
                }
                const result = addNote({ content, tags, source: 'user' });
                if (result.ok) {
                    const tagStr = result.note.tags.length > 0 ? ` [${result.note.tags.join(',')}]` : '';
                    bot.sendMessage(chatId, `📝 筆記 #${result.note.id}${tagStr} 已儲存：${result.note.content}`);
                } else {
                    bot.sendMessage(chatId, `❌ ${result.error}`);
                }
                return true;
            }

            if (args.startsWith('remove ') || args.startsWith('del ')) {
                const id = parseInt(args.split(' ')[1], 10);
                if (!id) {
                    bot.sendMessage(chatId, '❌ 用法: /note remove <id>');
                    return true;
                }
                const ok = removeNote(id);
                bot.sendMessage(chatId, ok ? `✅ 筆記 #${id} 已刪除` : `❌ 找不到筆記 #${id}`);
                return true;
            }

            if (args.startsWith('search ')) {
                const keyword = args.substring(7).trim();
                if (!keyword) {
                    bot.sendMessage(chatId, '❌ 用法: /note search 關鍵字');
                    return true;
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
                return true;
            }

            bot.sendMessage(chatId, '❌ 未知指令。\n用法: /note [add|remove|search]');
            return true;
        }

        // === /recall ===
        if (text.startsWith('/recall ')) {
            const keyword = text.substring(8).trim();
            if (!keyword) {
                bot.sendMessage(chatId, '❌ 用法: /recall 關鍵字');
                return true;
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
            return true;
        }

        // === /memory ===
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
            return true;
        }

        // === /cancel ===
        if (text === '/cancel') {
            if (!rpc.currentCascade) {
                bot.sendMessage(chatId, '❌ 沒有進行中的對話。');
                return true;
            }
            const ok = await rpc.cancelCascade();
            bot.sendMessage(chatId, ok ? '⛔ AI 執行已取消。' : '❌ 取消失敗，可能已經完成。');
            return true;
        }

        // === /model ===
        if (text === '/model') {
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
            return true;
        }

        if (text.startsWith('/model ')) {
            const newModel = text.substring(7).trim();
            if (newModel) {
                config.model = newModel;
                bot.sendMessage(chatId, `🤖 模型已切換為: ${newModel}`);
            }
            return true;
        }

        // === /cascades ===
        if (text === '/cascades') {
            const summaries = await rpc.listCascades();
            const entries = Object.entries(summaries);
            if (entries.length === 0) {
                bot.sendMessage(chatId, '📋 沒有對話記錄。');
                return true;
            }
            const lines = entries.slice(0, 10).map(([id, info]) => {
                const current = id === rpc.currentCascade ? ' ← 目前' : '';
                const title = info?.title || info?.firstMessage?.substring(0, 40) || '(no title)';
                return `• ${id.substring(0, 8)}... ${title}${current}`;
            });
            bot.sendMessage(chatId, ['📋 對話列表：', '', ...lines, '', `共 ${entries.length} 個對話`].join('\n'));
            return true;
        }

        // 未知的 / 開頭指令，忽略
        if (text.startsWith('/')) return true;

        // 不是指令
        return false;
    };
}
