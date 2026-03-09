// lib/memory.js — Multi-layer memory system
// 三層記憶系統：Pins（釘選）+ Notes（筆記）+ Recall（歷史搜尋）

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadHistory } from './history.js';

const DATA_DIR = join(process.cwd(), 'data');
const PINS_FILE = join(DATA_DIR, 'pins.json');
const NOTES_FILE = join(DATA_DIR, 'notes.json');

mkdirSync(DATA_DIR, { recursive: true });

// ============================================================
//  Layer 1: Pins — Standing context, always injected
//  釘選 — 常駐背景知識，每次新 cascade 都帶上
// ============================================================

const MAX_PINS = 10;
const MAX_PIN_LENGTH = 200;

export function loadPins() {
    try {
        if (!existsSync(PINS_FILE)) return [];
        const data = JSON.parse(readFileSync(PINS_FILE, 'utf8'));
        if (!Array.isArray(data)) { console.warn('  ⚠ pins.json is not an array, resetting'); return []; }
        return data;
    } catch (err) { console.warn(`  ⚠ pins.json load error: ${err.message}`); return []; }
}

function savePins(pins) {
    writeFileSync(PINS_FILE, JSON.stringify(pins, null, 2), 'utf8');
}

export function addPin(text) {
    const pins = loadPins();
    if (pins.length >= MAX_PINS) {
        return { ok: false, error: `已達上限 ${MAX_PINS} 條，請先刪除舊的` };
    }
    const trimmed = text.substring(0, MAX_PIN_LENGTH);
    const pin = {
        id: pins.length > 0 ? Math.max(...pins.map(p => p.id)) + 1 : 1,
        text: trimmed,
        createdAt: new Date().toISOString(),
    };
    pins.push(pin);
    savePins(pins);
    return { ok: true, pin };
}

export function removePin(id) {
    const pins = loadPins();
    const idx = pins.findIndex(p => p.id === id);
    if (idx === -1) return false;
    pins.splice(idx, 1);
    savePins(pins);
    return true;
}

export function clearPins() {
    savePins([]);
}

export function formatPinsForInjection() {
    const pins = loadPins();
    if (pins.length === 0) return '';
    const lines = pins.map(p => `- ${p.text}`);
    return `[記憶 - 釘選]\n${lines.join('\n')}`;
}

// ============================================================
//  Layer 2: Notes — Knowledge base with tags
//  筆記 — 帶標籤的知識庫，根據關鍵字匹配注入
// ============================================================

const MAX_NOTES = 50;
const MAX_NOTE_LENGTH = 500;

export function loadNotes() {
    try {
        if (!existsSync(NOTES_FILE)) return [];
        const data = JSON.parse(readFileSync(NOTES_FILE, 'utf8'));
        if (!Array.isArray(data)) { console.warn('  ⚠ notes.json is not an array, resetting'); return []; }
        return data;
    } catch (err) { console.warn(`  ⚠ notes.json load error: ${err.message}`); return []; }
}

function saveNotes(notes) {
    writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf8');
}

export function addNote({ content, tags = [], source = 'user' }) {
    const notes = loadNotes();
    if (notes.length >= MAX_NOTES) {
        return { ok: false, error: `已達上限 ${MAX_NOTES} 條，請先刪除舊的` };
    }
    const trimmed = content.substring(0, MAX_NOTE_LENGTH);
    const note = {
        id: notes.length > 0 ? Math.max(...notes.map(n => n.id)) + 1 : 1,
        content: trimmed,
        tags: tags.map(t => t.toLowerCase()),
        source,
        createdAt: new Date().toISOString(),
    };
    notes.push(note);
    saveNotes(notes);
    return { ok: true, note };
}

export function removeNote(id) {
    const notes = loadNotes();
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return false;
    notes.splice(idx, 1);
    saveNotes(notes);
    return true;
}

export function searchNotes(query) {
    const notes = loadNotes();
    const q = query.toLowerCase();
    return notes.filter(n =>
        n.content.toLowerCase().includes(q)
        || n.tags.some(t => t.includes(q))
    );
}

/**
 * Get notes relevant to a user message.
 * Keyword matching: splits on spaces/punctuation + CJK N-grams for Chinese support.
 * Returns top N most relevant notes.
 */
export function getRelevantNotes(userMessage, max = 3) {
    const notes = loadNotes();
    if (notes.length === 0) return [];

    const msg = userMessage.toLowerCase();

    // Tokenize: split on spaces/punctuation
    const spaceSplit = msg
        .split(/[\s,.\-!?;:。，、！？；：\n]+/)
        .filter(t => t.length >= 2);

    // For CJK: generate 2-gram and 3-gram tokens from the whole message
    // This helps match Chinese text that has no word boundaries
    const cjkGrams = new Set();
    const cleanMsg = msg.replace(/[\s,.\-!?;:。，、！？；：\n]/g, '');
    for (let n = 2; n <= 3; n++) {
        for (let i = 0; i <= cleanMsg.length - n; i++) {
            cjkGrams.add(cleanMsg.substring(i, i + n));
        }
    }

    // Combine all tokens (deduplicate)
    const tokens = [...new Set([...spaceSplit, ...cjkGrams])];
    if (tokens.length === 0) return [];

    // Score each note by keyword overlap
    const scored = notes.map(note => {
        const text = (note.content + ' ' + note.tags.join(' ')).toLowerCase();
        let score = 0;
        for (const token of tokens) {
            if (text.includes(token)) {
                // Longer matches score higher
                score += token.length >= 3 ? 2 : 1;
            }
        }
        return { note, score };
    });

    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, max)
        .map(s => s.note);
}

export function formatNotesForInjection(notes) {
    if (!notes || notes.length === 0) return '';
    const lines = notes.map(n => {
        const tagStr = n.tags.length > 0 ? ` [${n.tags.join(', ')}]` : '';
        return `- ${n.content}${tagStr}`;
    });
    return `[記憶 - 相關筆記]\n${lines.join('\n')}`;
}

// ============================================================
//  Layer 3: Recall — Search conversation history
//  歷史搜尋 — 搜尋過去對話記錄
// ============================================================

export function searchHistory(keyword, maxResults = 5) {
    const history = loadHistory();
    const q = keyword.toLowerCase();
    const matches = [];

    for (let i = history.length - 1; i >= 0 && matches.length < maxResults; i--) {
        const entry = history[i];
        if (entry.text && entry.text.toLowerCase().includes(q)) {
            matches.push(entry);
        }
    }

    return matches;
}

export function formatRecallForInjection(entries) {
    if (!entries || entries.length === 0) return '';
    const lines = entries.map(e => {
        const role = e.role === 'user' ? '👤' : '🤖';
        const time = e.ts ? ` (${e.ts.substring(0, 16)})` : '';
        const text = e.text.length > 200 ? e.text.substring(0, 200) + '...' : e.text;
        return `${role}${time}: ${text}`;
    });
    return `[歷史回顧]\n${lines.join('\n')}`;
}

// ============================================================
//  Context Builder — Assemble memory for system prompt injection
//  組裝記憶上下文
// ============================================================

export function buildMemoryContext(userMessage) {
    const parts = [];

    // Always include pins
    const pinsStr = formatPinsForInjection();
    if (pinsStr) parts.push(pinsStr);

    // Include relevant notes (keyword-matched)
    if (userMessage) {
        const relevant = getRelevantNotes(userMessage, 3);
        const notesStr = formatNotesForInjection(relevant);
        if (notesStr) parts.push(notesStr);
    }

    return parts.join('\n\n');
}

// ============================================================
//  Response Parser — Extract REMEMBER: and RECALL: markers
//  解析 AI 回覆中的記憶標記
// ============================================================

const REMEMBER_REGEX = /REMEMBER:\s*(?:\[([^\]]*)\])?\s*(.+?)(?:\n|$)/g;
const RECALL_REGEX = /RECALL:\s*(.+?)(?:\n|$)/g;

/**
 * Parse AI response for memory markers:
 *   REMEMBER: [tag1,tag2] content  → save as note
 *   RECALL: keyword                → search history
 *
 * Returns: { remembers: [{tags, content}], recalls: [keyword], cleanText }
 */
export function extractMemoryMarkers(text) {
    const remembers = [];
    const recalls = [];

    // Extract REMEMBER: markers
    let match;
    const rememberRegex = new RegExp(REMEMBER_REGEX.source, 'g');
    while ((match = rememberRegex.exec(text)) !== null) {
        const tags = match[1] ? match[1].split(',').map(t => t.trim()).filter(Boolean) : [];
        const content = match[2].trim();
        if (content) remembers.push({ tags, content });
    }

    // Extract RECALL: markers
    const recallRegex = new RegExp(RECALL_REGEX.source, 'g');
    while ((match = recallRegex.exec(text)) !== null) {
        const keyword = match[1].trim();
        if (keyword) recalls.push(keyword);
    }

    // Remove markers from text
    let cleanText = text
        .replace(/REMEMBER:\s*(?:\[[^\]]*\])?\s*.+?(?:\n|$)/g, '')
        .replace(/RECALL:\s*.+?(?:\n|$)/g, '')
        .trim();

    return { remembers, recalls, cleanText };
}

// ============================================================
//  Memory Summary — Overview of all memory layers
//  記憶總覽
// ============================================================

export function getMemorySummary() {
    const pins = loadPins();
    const notes = loadNotes();
    const history = loadHistory();

    return {
        pins: { count: pins.length, max: MAX_PINS },
        notes: { count: notes.length, max: MAX_NOTES },
        history: { count: history.length },
    };
}
