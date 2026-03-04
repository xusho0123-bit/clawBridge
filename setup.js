#!/usr/bin/env node
// ============================================================
//  Antigravity Bridge — Interactive Setup
//  互動式設定精靈
// ============================================================

import { createInterface } from 'readline';
import { writeFileSync, existsSync } from 'fs';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
    console.log('=== Antigravity Bridge Setup ===');
    console.log('=== Antigravity Bridge 設定精靈 ===\n');

    if (existsSync('.env')) {
        const overwrite = await ask('.env already exists. Overwrite? (y/N): ');
        if (overwrite.toLowerCase() !== 'y') {
            console.log('Cancelled.');
            rl.close();
            return;
        }
    }

    // Step 1: Telegram Bot Token
    console.log('\n--- Step 1: Create a Telegram Bot ---');
    console.log('--- 第一步：建立 Telegram Bot ---\n');
    console.log('  1. Open Telegram, search @BotFather');
    console.log('     打開 Telegram，搜尋 @BotFather');
    console.log('  2. Send /newbot, follow instructions');
    console.log('     傳送 /newbot，按照指示操作');
    console.log('  3. Copy the bot token');
    console.log('     複製 bot token\n');

    const token = await ask('Paste your bot token / 貼上 bot token: ');
    if (!token.includes(':')) {
        console.log('\nInvalid token format. Should be like: 123456789:ABCdef...');
        rl.close();
        return;
    }

    // Step 2: User ID
    console.log('\n--- Step 2: Get your Telegram User ID (optional) ---');
    console.log('--- 第二步：取得你的 Telegram User ID（選填）---\n');
    console.log('  Send any message to @userinfobot on Telegram');
    console.log('  在 Telegram 傳訊息給 @userinfobot\n');

    const userId = await ask('Your User ID (or Enter to skip) / 你的 User ID（或按 Enter 跳過）: ');

    // Step 3: Project Path
    console.log('\n--- Step 3: Project folder for Antigravity (optional) ---');
    console.log('--- 第三步：Antigravity 專案資料夾（選填）---\n');
    console.log('  Antigravity needs a project open to start Language Server.');
    console.log('  Antigravity 需要開啟專案才會啟動 Language Server。');
    console.log('  This is used by start.command for auto-launch.');
    console.log('  start.command 會用此路徑自動開啟專案。\n');

    const projectPath = await ask('Project folder path (or Enter to skip) / 專案路徑（或按 Enter 跳過）: ');

    // Step 4: Model
    console.log('\n--- Step 4: AI Model (optional) ---');
    console.log('--- 第四步：AI 模型（選填）---\n');
    console.log('  Default: MODEL_PLACEHOLDER_M18 (Gemini 3 Flash)');
    console.log('  預設：MODEL_PLACEHOLDER_M18 (Gemini 3 Flash)\n');

    const model = await ask('Model ID (or Enter for default) / 模型 ID（或按 Enter 使用預設）: ');

    // Write .env
    const lines = [
        `TELEGRAM_BOT_TOKEN=${token.trim()}`,
    ];
    if (userId.trim()) {
        lines.push(`ALLOWED_USER_ID=${userId.trim()}`);
    }
    if (projectPath.trim()) {
        lines.push(`PROJECT_PATH=${projectPath.trim()}`);
    }
    if (model.trim()) {
        lines.push(`AI_MODEL=${model.trim()}`);
    }

    writeFileSync('.env', lines.join('\n') + '\n');

    console.log('\n.env created!');
    console.log('.env 已建立！\n');
    console.log('Now run: npm start');
    console.log('現在執行：npm start\n');

    rl.close();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
