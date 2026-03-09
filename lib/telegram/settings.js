// lib/telegram/settings.js — IDE Settings helper
// 讀寫 Antigravity IDE settings.json + auto-approve 設定

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const IDE_SETTINGS_PATH = process.platform === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Antigravity', 'User', 'settings.json')
    : join(homedir(), 'Library', 'Application Support', 'Antigravity', 'User', 'settings.json');

export function readIdeSettings() {
    try {
        return JSON.parse(readFileSync(IDE_SETTINGS_PATH, 'utf8'));
    } catch { return {}; }
}

export function writeIdeSettings(settings) {
    writeFileSync(IDE_SETTINGS_PATH, JSON.stringify(settings, null, 4) + '\n', 'utf8');
}

// Auto-approve setting keys
export const APPROVE_KEYS = {
    edits: 'chat.tools.edits.autoApprove',
    terminal: 'chat.tools.terminal.autoApprove',
    urls: 'chat.tools.urls.autoApprove',
    all: 'chat.tools.global.autoApprove',
};
