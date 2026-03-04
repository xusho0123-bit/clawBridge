// lib/scheduler.js — Simple daily scheduler
// 簡易每日排程：每天 HH:MM 自動發送訊息給 AI

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');
const SCHEDULE_FILE = join(DATA_DIR, 'schedules.json');

mkdirSync(DATA_DIR, { recursive: true });

export function loadSchedules() {
    try {
        if (!existsSync(SCHEDULE_FILE)) return [];
        return JSON.parse(readFileSync(SCHEDULE_FILE, 'utf8'));
    } catch { return []; }
}

export function saveSchedules(schedules) {
    writeFileSync(SCHEDULE_FILE, JSON.stringify(schedules, null, 2), 'utf8');
}

export function addSchedule({ time, message, chatId }) {
    const schedules = loadSchedules();
    const nextId = schedules.length > 0
        ? Math.max(...schedules.map(s => s.id)) + 1
        : 1;
    const schedule = { id: nextId, time, message, chatId, enabled: true };
    schedules.push(schedule);
    saveSchedules(schedules);
    return schedule;
}

export function removeSchedule(id) {
    const schedules = loadSchedules();
    const idx = schedules.findIndex(s => s.id === id);
    if (idx === -1) return false;
    schedules.splice(idx, 1);
    saveSchedules(schedules);
    return true;
}

// Returns schedules that match current HH:MM
export function getTriggeredSchedules() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hh}:${mm}`;
    const schedules = loadSchedules();
    return schedules.filter(s => s.enabled && s.time === currentTime);
}
