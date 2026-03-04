// lib/history.js — Session persistence and conversation history
// 對話記錄持久化：session 狀態 + 歷史訊息

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');
const SESSION_FILE = join(DATA_DIR, 'session.json');
const HISTORY_FILE = join(DATA_DIR, 'history.json');
const MAX_HISTORY = 200;

mkdirSync(DATA_DIR, { recursive: true });

// ============================================================
//  Session: save/restore cascade state across restarts
// ============================================================

export function saveSession(data) {
    writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function loadSession() {
    try {
        if (!existsSync(SESSION_FILE)) return null;
        const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
        return data?.cascadeId ? data : null;
    } catch { return null; }
}

export function clearSession() {
    try { writeFileSync(SESSION_FILE, '{}', 'utf8'); } catch {}
}

// ============================================================
//  History: append-only conversation log (max 200 messages)
// ============================================================

export function appendHistory(role, text) {
    const history = loadHistory();
    history.push({
        role,
        text: text.substring(0, 2000),
        ts: new Date().toISOString(),
    });
    while (history.length > MAX_HISTORY) history.shift();
    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

export function loadHistory() {
    try {
        if (!existsSync(HISTORY_FILE)) return [];
        return JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
    } catch { return []; }
}

export function clearHistory() {
    writeFileSync(HISTORY_FILE, '[]', 'utf8');
}
