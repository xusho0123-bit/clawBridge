#!/usr/bin/env node
// Debug: dump full trajectory to understand step structure
// 用途：dump 完整 trajectory 結構，搞清楚 step 的種類和狀態

import https from 'https';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

const agent = new https.Agent({ rejectUnauthorized: false });

function callRPC(port, csrfToken, method, payload) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const req = https.request({
            hostname: '127.0.0.1', port,
            path: `/exa.language_server_pb.LanguageServerService/${method}`,
            method: 'POST', timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'x-codeium-csrf-token': csrfToken,
                'connect-protocol-version': '1',
            },
            agent,
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try { resolve(JSON.parse(data || '{}')); }
                    catch { resolve({ _raw: data }); }
                } else {
                    reject(new Error(`${method} ${res.statusCode}: ${data.substring(0, 500)}`));
                }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', e => reject(e));
        req.write(body);
        req.end();
    });
}

// Detect
const ps = execSync('ps aux', { encoding: 'utf-8' });
const line = ps.split('\n').find(l => l.includes('--csrf_token'));
const csrfToken = line?.match(/--csrf_token\s+(\S+)/)?.[1];
const lsof = execSync('lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null | grep language', { encoding: 'utf-8' });
const port = lsof.match(/:(\d+)\s+\(LISTEN\)/)?.[1];

console.log(`CSRF: ${csrfToken?.substring(0, 8)}... Port: ${port}\n`);

const cascadeId = randomUUID();

// Step 1: Start
await callRPC(port, csrfToken, 'StartCascade', {
    cascadeId, metadata: { ideName: 'antigravity' },
});
console.log(`Cascade: ${cascadeId.substring(0, 8)}...\n`);

// Step 2: Send message
const msg = process.argv[2] || '你好，請簡短回答';
console.log(`Sending: "${msg}"\n`);

await callRPC(port, csrfToken, 'SendUserCascadeMessage', {
    cascadeId,
    items: [{ text: msg }],
    metadata: { ideName: 'antigravity' },
    cascadeConfig: {
        plannerConfig: {
            conversational: {},
            requestedModel: { model: 'MODEL_PLACEHOLDER_M18' },
        },
    },
});

// Step 3: Poll and dump EVERYTHING
console.log('--- Polling trajectory (every 1s, max 60s) ---\n');

for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));

    const res = await callRPC(port, csrfToken, 'GetCascadeTrajectory', {
        cascadeId, metadata: { ideName: 'antigravity' },
    });

    // Show top-level keys (excluding steps)
    const topKeys = Object.keys(res?.trajectory || {}).filter(k => k !== 'steps');
    if (topKeys.length > 0) {
        console.log(`[${i+1}s] Top-level trajectory keys: ${topKeys.join(', ')}`);
        for (const k of topKeys) {
            const val = res.trajectory[k];
            if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
                console.log(`  ${k}: ${val}`);
            } else {
                console.log(`  ${k}: ${JSON.stringify(val).substring(0, 200)}`);
            }
        }
    }

    const steps = res?.trajectory?.steps || [];
    console.log(`[${i+1}s] Steps: ${steps.length}`);

    let allDone = true;
    for (let j = 0; j < steps.length; j++) {
        const step = steps[j];
        const type = step.type?.replace('CORTEX_STEP_TYPE_', '') || 'UNKNOWN';
        const status = step.status?.replace('CORTEX_STEP_STATUS_', '') || '?';

        let detail = '';
        if (step.plannerResponse?.response) {
            const text = step.plannerResponse.response;
            detail = ` text="${text.substring(0, 80)}${text.length > 80 ? '...' : ''}" (${text.length} chars)`;
        }
        if (step.userMessage) {
            detail = ` user="${step.userMessage?.items?.[0]?.text?.substring(0, 40) || '?'}"`;
        }

        // Show ALL fields for non-standard step types
        const knownTypes = ['PLANNER_RESPONSE', 'USER_MESSAGE'];
        if (!knownTypes.includes(type)) {
            detail = ` ${JSON.stringify(step).substring(0, 300)}`;
        }

        console.log(`  [${j}] ${type} (${status})${detail}`);

        if (status !== 'DONE') allDone = false;
    }

    // Check if last PLANNER_RESPONSE is DONE
    const lastPR = [...steps].reverse().find(s => s.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE');
    if (lastPR?.status === 'CORTEX_STEP_STATUS_DONE' && lastPR?.plannerResponse?.response) {
        console.log(`\n=== DONE ===`);
        console.log(`Final response (${lastPR.plannerResponse.response.length} chars):`);
        console.log(lastPR.plannerResponse.response);
        console.log(`\nAll steps done: ${allDone}`);

        // Dump full trajectory JSON for analysis
        const dumpFile = `/tmp/trajectory-dump-${Date.now()}.json`;
        const fs = await import('fs');
        fs.writeFileSync(dumpFile, JSON.stringify(res, null, 2));
        console.log(`\nFull dump: ${dumpFile}`);
        break;
    }

    console.log('');
}
