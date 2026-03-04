// lib/rpc.js — Connect protocol RPC client for Antigravity Language Server
// Antigravity Language Server 的 Connect 協定 RPC 客戶端

import https from 'https';
import { randomUUID } from 'crypto';

const agent = new https.Agent({ rejectUnauthorized: false });

// ============================================================
//  Low-level RPC call
// ============================================================

function callRPC(port, csrfToken, method, payload, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const req = https.request({
            hostname: '127.0.0.1',
            port,
            path: `/exa.language_server_pb.LanguageServerService/${method}`,
            method: 'POST',
            timeout,
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
                    reject(new Error(`${method} ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
            res.on('error', e => reject(new Error(`${method} response: ${e.message}`)));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error(`${method} timeout`)); });
        req.on('error', e => reject(new Error(`${method} request: ${e.message}`)));
        req.write(body);
        req.end();
    });
}

// ============================================================
//  RPC Client
// ============================================================

export function createRpcClient(connection, options = {}) {
    let csrfToken = connection?.csrfToken;
    let port = connection?.port;
    let cascadeId = null;
    let cascadeStarted = false;
    let knownExecutorCount = 0;
    let isFirstMessage = true;
    const systemPrompt = options.systemPrompt || '';

    async function startCascade() {
        cascadeId = randomUUID();
        cascadeStarted = false;
        knownExecutorCount = 0;
        console.log(`  New cascade: ${cascadeId.substring(0, 8)}...`);

        await callRPC(port, csrfToken, 'StartCascade', {
            cascadeId,
            metadata: { ideName: 'antigravity' },
        });

        cascadeStarted = true;
        return cascadeId;
    }

    async function sendMessage(text, model, mediaItems = null) {
        // Prepend system prompt to the first message of each cascade
        const fullText = (isFirstMessage && systemPrompt)
            ? `[System Instructions]\n${systemPrompt}\n[/System Instructions]\n\n${text}`
            : text;
        isFirstMessage = false;

        const payload = {
            cascadeId,
            items: [{ text: fullText }],
            metadata: { ideName: 'antigravity' },
            cascadeConfig: {
                plannerConfig: {
                    conversational: {},
                    requestedModel: { model },
                },
            },
        };

        // Attach media (images, etc.) if provided
        // Uses the "media" field with inlineData (base64-encoded bytes)
        if (mediaItems && mediaItems.length > 0) {
            payload.media = mediaItems;
        }

        await callRPC(port, csrfToken, 'SendUserCascadeMessage', payload);
    }

    // Get current trajectory snapshot (step count + executor count)
    async function getTrajectorySnapshot() {
        try {
            const res = await callRPC(port, csrfToken, 'GetCascadeTrajectory', {
                cascadeId,
                metadata: { ideName: 'antigravity' },
            });
            const trajectory = res?.trajectory || {};
            return {
                stepCount: (trajectory.steps || []).length,
                executorCount: (trajectory.executorMetadatas || []).length,
            };
        } catch {
            return { stepCount: 0, executorCount: 0 };
        }
    }

    // Poll for AI response
    // preStepCount: only look at steps AFTER this index (new steps from our message)
    // preExecutorCount: only consider executors AFTER this count
    async function pollResponse(timeoutMs, onUpdate, preStepCount, preExecutorCount) {
        const startTime = Date.now();
        let lastResponse = '';
        let lastResponseChangedAt = 0;     // timestamp when text last changed
        let lastResponseStepDone = false;   // is the last PLANNER_RESPONSE step DONE?
        const STABLE_MS = 5000;             // return if text stable for this long
        const STUCK_MS = 60000;             // truly stuck: no new activity for 60s
        let lastStepCount = preStepCount;   // track step count changes
        let lastActivityAt = Date.now();    // when we last saw new steps appear
        let executorDoneAt = 0;             // when first executor finished without text
        const GRACE_MS = 15000;             // wait up to 15s more for text after executor done

        while (Date.now() - startTime < timeoutMs) {
            try {
                const res = await callRPC(port, csrfToken, 'GetCascadeTrajectory', {
                    cascadeId,
                    metadata: { ideName: 'antigravity' },
                });

                const trajectory = res?.trajectory || {};
                const steps = trajectory.steps || [];
                const executors = trajectory.executorMetadatas || [];

                // === Only look at NEW steps (after our message was sent) ===
                let newResponseText = '';
                let lastPlannerStepDone = false;
                for (let i = preStepCount; i < steps.length; i++) {
                    const step = steps[i];
                    if (step.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE'
                        && step.plannerResponse?.response) {
                        newResponseText = step.plannerResponse.response;
                        lastPlannerStepDone = step.status === 'CORTEX_STEP_STATUS_DONE';
                    }
                }

                // Track activity: if new steps appeared, AI is still working
                if (steps.length > lastStepCount) {
                    lastActivityAt = Date.now();
                    lastStepCount = steps.length;
                }

                // === Check if a NEW executor completed ===
                const isNewExecutorDone = executors.length > preExecutorCount
                    && !!executors[executors.length - 1]?.terminationReason;

                // === Primary completion: executor done + response text ===
                if (isNewExecutorDone && newResponseText) {
                    knownExecutorCount = executors.length;
                    const reason = executors[executors.length - 1].terminationReason
                        ?.replace('EXECUTOR_TERMINATION_REASON_', '') || '?';
                    console.log(`  Response done (${newResponseText.length} chars, reason: ${reason})`);
                    return newResponseText;
                }

                // === Text found (even without executor done) ===
                // This catches cases where text appears in steps from a follow-up executor
                if (executorDoneAt && newResponseText && lastPlannerStepDone) {
                    knownExecutorCount = executors.length;
                    console.log(`  Response found after grace wait (${newResponseText.length} chars)`);
                    return newResponseText;
                }

                // === Executor done but NO text — start grace period, don't return yet ===
                if (isNewExecutorDone && !newResponseText && !executorDoneAt) {
                    executorDoneAt = Date.now();
                    // Update baseline so we can detect follow-up executors
                    preExecutorCount = executors.length;
                    console.log(`  Executor done but no text yet, waiting ${GRACE_MS / 1000}s for follow-up...`);
                    // === DEBUG DUMP: 印出所有新 step 的完整結構 ===
                    console.log(`  === DEBUG: All new steps (from ${preStepCount}) ===`);
                    for (let i = preStepCount; i < steps.length; i++) {
                        const step = steps[i];
                        const t = step.type?.replace('CORTEX_STEP_TYPE_', '') || '?';
                        const s = step.status?.replace('CORTEX_STEP_STATUS_', '') || '?';
                        console.log(`    step[${i}] ${t} (${s})`);
                        // Dump plannerResponse if exists
                        if (step.plannerResponse) {
                            const pr = step.plannerResponse;
                            console.log(`      plannerResponse keys: ${Object.keys(pr).join(', ')}`);
                            if (pr.response) console.log(`      response: "${pr.response.substring(0, 100)}..."`);
                            else console.log(`      response: (empty/null)`);
                        }
                        // Dump all top-level keys of the step (excluding type/status)
                        const stepKeys = Object.keys(step).filter(k => !['type', 'status'].includes(k));
                        if (stepKeys.length > 0) {
                            console.log(`      other keys: ${stepKeys.join(', ')}`);
                            for (const k of stepKeys) {
                                const v = JSON.stringify(step[k]);
                                console.log(`      ${k}: ${v?.substring(0, 200)}`);
                            }
                        }
                    }
                    console.log(`  === DEBUG: Executors (${executors.length}) ===`);
                    for (let i = 0; i < executors.length; i++) {
                        console.log(`    exec[${i}]: ${JSON.stringify(executors[i]).substring(0, 200)}`);
                    }
                    console.log(`  === END DEBUG ===`);
                }

                // === Grace period expired — give up ===
                if (executorDoneAt && Date.now() - executorDoneAt >= GRACE_MS && !newResponseText) {
                    knownExecutorCount = executors.length;
                    console.log(`  Grace period expired, no text response found`);
                    return '(AI 執行完畢但無文字回覆，可能需要在 IDE 中查看結果)';
                }

                // === Track text stability for fallback ===
                if (newResponseText && newResponseText !== lastResponse) {
                    lastResponse = newResponseText;
                    lastResponseChangedAt = Date.now();
                    lastResponseStepDone = lastPlannerStepDone;
                    if (onUpdate) onUpdate(newResponseText);
                } else if (newResponseText && lastPlannerStepDone) {
                    lastResponseStepDone = true;
                }

                // === Fallback 1: step DONE + text stable for 5s ===
                if (lastResponse && lastResponseStepDone && lastResponseChangedAt > 0
                    && Date.now() - lastResponseChangedAt >= STABLE_MS) {
                    console.log(`  Response stable fallback (${lastResponse.length} chars, stable ${Math.round((Date.now() - lastResponseChangedAt) / 1000)}s)`);
                    return lastResponse;
                }

                // === Fallback 2: has text + no new steps for 60s ===
                if (lastResponse && lastResponseChangedAt > 0
                    && Date.now() - lastActivityAt >= STUCK_MS) {
                    console.log(`  Response stuck fallback (${lastResponse.length} chars, no activity ${Math.round((Date.now() - lastActivityAt) / 1000)}s)`);
                    return lastResponse + '\n\n⚠ AI 可能卡住了，請檢查 IDE 或用 /yolo 開啟自動核准。';
                }

                // === Debug: log step progress periodically ===
                if (!lastResponse && steps.length > preStepCount) {
                    const elapsed = Math.round((Date.now() - startTime) / 1000);
                    if (elapsed % 15 === 0 && elapsed > 0) {
                        const stepTypes = [];
                        for (let i = preStepCount; i < steps.length; i++) {
                            stepTypes.push(steps[i].type?.replace('CORTEX_STEP_TYPE_', '') || '?');
                        }
                        console.log(`  Waiting... ${elapsed}s, steps: ${stepTypes.join(' → ')}`);
                    }
                }
            } catch (err) {
                console.error(`  Poll error: ${err.message}`);
            }

            await new Promise(r => setTimeout(r, 800));
        }

        if (lastResponse) return lastResponse;
        throw new Error('AI response timeout');
    }

    return {
        get connected() { return !!(csrfToken && port); },
        get currentCascade() { return cascadeId; },

        updateConnection(conn) {
            csrfToken = conn.csrfToken;
            port = conn.port;
        },

        resetCascade() {
            cascadeId = null;
            cascadeStarted = false;
            knownExecutorCount = 0;
            isFirstMessage = true;
        },

        // Health check: verify LS connection is alive
        async healthCheck() {
            if (!csrfToken || !port) return false;
            try {
                await callRPC(port, csrfToken, 'GetCommandModelConfigs', {
                    metadata: { ideName: 'antigravity' },
                }, 5000);
                return true;
            } catch { return false; }
        },

        // Verify if a saved cascade still exists on LS
        async verifyCascade(id) {
            if (!csrfToken || !port) return false;
            try {
                const res = await callRPC(port, csrfToken, 'GetCascadeTrajectory', {
                    cascadeId: id,
                    metadata: { ideName: 'antigravity' },
                }, 5000);
                return !!(res?.trajectory);
            } catch { return false; }
        },

        // Restore cascade from saved session (skip StartCascade)
        restoreCascade(savedId) {
            cascadeId = savedId;
            cascadeStarted = true;
            isFirstMessage = false;
            console.log(`  Restored cascade: ${cascadeId.substring(0, 8)}...`);
        },

        // Get current state for persistence
        getState() {
            return { cascadeId, cascadeStarted };
        },

        async sendToAI(message, model, onUpdate = null, timeoutMs = 120000, mediaItems = null) {
            if (!csrfToken || !port) throw new Error('Not connected');

            if (!cascadeId || !cascadeStarted) {
                await startCascade();
            }

            try {
                // Snapshot BEFORE sending — so we only look at new steps/executors
                const snap = await getTrajectorySnapshot();

                await sendMessage(message, model, mediaItems);
                return await pollResponse(timeoutMs, onUpdate, snap.stepCount, snap.executorCount);
            } catch (err) {
                // Auto-recovery: if cascade is broken, reset and retry once
                if (err.message.includes('INTERNAL') || err.message.includes('cascade')
                    || err.message.includes('404') || err.message.includes('400')) {
                    console.log('  Cascade error, auto-resetting...');
                    await startCascade();
                    const snap = await getTrajectorySnapshot();
                    await sendMessage(message, model, mediaItems);
                    return await pollResponse(timeoutMs, onUpdate, snap.stepCount, snap.executorCount);
                }
                throw err;
            }
        },
    };
}
