#!/usr/bin/env node
// ============================================================
//  Antigravity Bridge v2.6
//  Chat with Antigravity IDE's built-in AI via Telegram
//  透過 Telegram 與 Antigravity IDE 內建 AI 對話
//
//  Usage: npm start
//  Setup: npm run setup
// ============================================================

import 'dotenv/config';
import { detectConnection } from './lib/detect.js';
import { createRpcClient } from './lib/rpc.js';
import { startTelegramBot } from './lib/telegram.js';
import { loadSession, clearSession } from './lib/history.js';

// Validate config
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TG_TOKEN) {
    console.error('Missing TELEGRAM_BOT_TOKEN.');
    console.error('Run: npm run setup');
    process.exit(1);
}

const config = {
    tgToken: TG_TOKEN,
    allowedUsers: process.env.ALLOWED_USER_ID
        ? process.env.ALLOWED_USER_ID.split(',').map(s => s.trim())
        : null,
    model: process.env.AI_MODEL || 'MODEL_PLACEHOLDER_M18',
    pollTimeout: parseInt(process.env.POLL_TIMEOUT_MS || '300000', 10),
};

// Detect Language Server
console.log('Antigravity Bridge v2.6\n');
console.log('Detecting Language Server...');

const connection = await detectConnection();
if (!connection) {
    console.log('\nLanguage Server not found.');
    console.log('Make sure Antigravity IDE is running.\n');
    console.log('Bot is running — use /reconnect after starting Antigravity.\n');
}

// Start
const systemPrompt = process.env.SYSTEM_PROMPT || '';
const rpc = createRpcClient(connection, { systemPrompt });

// Try to restore previous session (conversation persistence)
const savedSession = loadSession();
if (savedSession?.cascadeId && connection) {
    const valid = await rpc.verifyCascade(savedSession.cascadeId);
    if (valid) {
        rpc.restoreCascade(savedSession.cascadeId);
        console.log('Previous conversation restored!');
    } else {
        console.log('Previous session expired, starting fresh.');
        clearSession();
    }
}

async function reconnect() {
    const conn = await detectConnection();
    return conn;
}

startTelegramBot(config, rpc, reconnect);

console.log('\nBridge ready!');
console.log(`Model: ${config.model}`);
console.log('Send a message to your Telegram bot.\n');
