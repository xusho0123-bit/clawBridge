// lib/rpc.js — Connect protocol RPC client for Antigravity Language Server
// Antigravity Language Server 的 Connect 協定 RPC 客戶端
// v2.6: StreamCascadeReactiveUpdates 真串流 + polling fallback

import https from 'https';
import { randomUUID } from 'crypto';

const agent = new https.Agent({ rejectUnauthorized: false });

// ============================================================
//  Low-level RPC call (JSON, non-streaming)
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
//  Streaming RPC call (Connect protocol binary framing)
//  Used for StreamCascadeReactiveUpdates
// ============================================================

function streamFetch(port, csrfToken, method, payload, onFrame, onEnd) {
    const jsonStr = JSON.stringify(payload);
    const encoded = Buffer.from(jsonStr, 'utf8');

    // Binary frame: [flags 1B][length 4B BE][payload]
    const frame = Buffer.alloc(5 + encoded.length);
    frame[0] = 0; // flags
    frame.writeUInt32BE(encoded.length, 1);
    encoded.copy(frame, 5);

    console.log(`  [stream] Connecting: ${method} (payload ${encoded.length}B)`);
    const req = https.request({
        hostname: '127.0.0.1',
        port,
        path: `/exa.language_server_pb.LanguageServerService/${method}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/connect+json',
            'x-codeium-csrf-token': csrfToken,
            'connect-protocol-version': '1',
        },
        agent,
    }, (res) => {
        console.log(`  [stream] HTTP ${res.statusCode} ${res.headers['content-type'] || ''}`);
        let buffer = Buffer.alloc(0);
        res.on('data', chunk => {
            console.log(`  [stream] chunk ${chunk.length}B (buffer ${buffer.length}B)`);
            buffer = Buffer.concat([buffer, chunk]);

            // Parse frames from buffer
            while (buffer.length >= 5) {
                const flags = buffer[0];
                const frameLen = buffer.readUInt32BE(1);

                if (buffer.length < 5 + frameLen) break; // incomplete frame

                const payloadStr = buffer.slice(5, 5 + frameLen).toString('utf8');
                buffer = buffer.slice(5 + frameLen);

                if (flags & 0x02) { // end-of-stream
                    if (onEnd) onEnd();
                    return;
                }

                if (onFrame) {
                    try { onFrame(payloadStr); }
                    catch (e) { console.error(`  Stream frame error: ${e.message}`); }
                }
            }
        });
        res.on('end', () => { if (onEnd) onEnd(); });
        res.on('error', (e) => { if (onEnd) onEnd(e); });
    });

    req.on('error', (e) => { console.error(`  [stream] req error: ${e.message}`); if (onEnd) onEnd(e); });
    req.write(frame);
    req.end();

    return { abort: () => req.destroy() };
}

// ============================================================
//  Stream frame parser (protobuf-like diff objects)
// ============================================================

function parseStreamFrame(jsonStr) {
    try {
        const obj = JSON.parse(jsonStr);
        const info = {
            thinking: [],
            response: [],
            toolCalls: [],
            trajectoryId: null,
            stepIndex: null,
            turnDone: false,
            newStepStarted: false,
            permissionWait: null,   // 'run_command' | 'file' | 'browser' | 'mcp'
            permissionPath: null,
            permissionCmd: null,
            serverError: null,
        };

        walkDiff(obj, [], info);

        // Check turn status at top-level diff
        const diffs = obj?.diff?.fieldDiffs;
        if (diffs && diffs.length === 1 && diffs[0].fieldNumber === 8) {
            const ev = diffs[0].updateSingular?.enumValue;
            if (ev === 1) info.turnDone = true;
            if (ev === 2) info.newStepStarted = true;
        }

        return info;
    } catch {
        return null;
    }
}

function walkDiff(node, fieldStack, info) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const item of node) walkDiff(item, fieldStack, info);
        return;
    }

    const fn = node.fieldNumber;
    const newStack = fn !== undefined ? [...fieldStack, fn] : fieldStack;
    const parentFn = fieldStack[fieldStack.length - 1];

    // Extract string values
    if (node.updateSingular?.stringValue !== undefined) {
        const sv = node.updateSingular.stringValue;
        // Thinking text (field 3, parent 20)
        if (fn === 3 && parentFn === 20) {
            info.thinking.push(sv);
        }
        // Response text (field 8, parent 20) — strip ephemeral messages
        else if (fn === 8 && parentFn === 20) {
            const cleaned = sv
                .replace(/<EPHEMERAL_MESSAGE>[\s\S]*?<\/EPHEMERAL_MESSAGE>/g, '')
                .replace(/<\/?EPHEMERAL_MESSAGE>/g, '')
                .trim();
            if (cleaned) info.response.push(cleaned);
        }
        // Trajectory ID (field 1, parent 20)
        else if (fn === 1 && parentFn === 20) {
            info.trajectoryId = sv;
        }
    }

    // Extract uint32 values
    if (node.updateSingular?.uint32Value !== undefined) {
        // Step index (field 2, parent 20)
        if (fn === 2 && parentFn === 20) {
            info.stepIndex = node.updateSingular.uint32Value;
        }
    }

    // Extract tool calls (field 7, parent 20)
    if (fn === 7 && parentFn === 20 && node.updateRepeated?.updateValues) {
        for (const val of node.updateRepeated.updateValues) {
            const diffs = val?.messageValue?.fieldDiffs;
            if (!diffs) continue;
            const tc = {};
            for (const d of diffs) {
                if (d.fieldNumber === 1 && d.updateSingular?.stringValue) tc.id = d.updateSingular.stringValue;
                if (d.fieldNumber === 2 && d.updateSingular?.stringValue) tc.toolName = d.updateSingular.stringValue;
                if (d.fieldNumber === 3 && d.updateSingular?.stringValue) {
                    try { Object.assign(tc, JSON.parse(d.updateSingular.stringValue)); }
                    catch { tc.argsRaw = d.updateSingular.stringValue; }
                }
            }
            if (tc.toolName) info.toolCalls.push(tc);
        }
    }

    // Extract permission requests (status enum 9 = WAITING)
    if (node.messageValue?.fieldDiffs) {
        const diffs = node.messageValue.fieldDiffs;
        let hasStatus9 = false, stepType = null;
        let permPath = null, cmdLine = null;

        for (const d of diffs) {
            if (d.fieldNumber === 4 && d.updateSingular?.enumValue === 9) hasStatus9 = true;
            if (d.fieldNumber === 1 && d.updateSingular?.enumValue != null) stepType = d.updateSingular.enumValue;

            // Extract file:/// URIs
            if (!permPath && d.fieldNumber !== 5 && d.fieldNumber !== 20) {
                try {
                    const s = JSON.stringify(d);
                    const m = s.match(/"file:\/\/\/[^"]+"/);
                    if (m) permPath = JSON.parse(m[0]);
                } catch { /* ignore */ }
            }

            // Extract command line (field 28 → field 23)
            if (d.fieldNumber === 28) {
                try {
                    const inner = d.updateSingular?.messageValue?.fieldDiffs;
                    if (inner) {
                        const f23 = inner.find(x => x.fieldNumber === 23);
                        if (f23?.updateSingular?.stringValue) cmdLine = f23.updateSingular.stringValue;
                    }
                } catch { /* ignore */ }
            }
        }

        if (hasStatus9 && !info.permissionWait) {
            if (stepType === 21) info.permissionWait = 'run_command';
            else if (stepType === 38) info.permissionWait = 'mcp';
            else if (permPath) info.permissionWait = 'file';
            else info.permissionWait = 'browser';

            if (permPath) info.permissionPath = permPath;
            if (cmdLine) info.permissionCmd = cmdLine;
        }
    }

    // Extract server errors (field 24)
    if (fn === 24 && node.updateSingular?.messageValue?.fieldDiffs) {
        const errDiffs = node.updateSingular.messageValue.fieldDiffs;
        let errMsg = null, errCode = null, errTech = null;
        for (const ed of errDiffs) {
            if (ed.fieldNumber === 3 && ed.updateSingular?.messageValue?.fieldDiffs) {
                for (const inner of ed.updateSingular.messageValue.fieldDiffs) {
                    if (inner.fieldNumber === 1) errMsg = inner.updateSingular?.stringValue;
                    if (inner.fieldNumber === 7) errCode = inner.updateSingular?.uint32Value;
                    if (inner.fieldNumber === 9) errTech = inner.updateSingular?.stringValue;
                }
            }
        }
        if (errMsg || errCode) {
            info.serverError = { code: errCode, message: errMsg, technical: errTech };
        }
    }

    // Recursive descent
    for (const key of Object.keys(node)) {
        const val = node[key];
        if (val && typeof val === 'object') walkDiff(val, newStack, info);
    }
}

// ============================================================
//  Polling fallback (kept for compatibility)
// ============================================================

function createPollingFallback(port, csrfToken, getCascadeId) {
    async function getTrajectorySnapshot() {
        try {
            const res = await callRPC(port, csrfToken, 'GetCascadeTrajectory', {
                cascadeId: getCascadeId(),
                metadata: { ideName: 'antigravity' },
            });
            const trajectory = res?.trajectory || {};
            const steps = trajectory.steps || [];
            let lastResponseText = '';
            for (let i = steps.length - 1; i >= 0; i--) {
                if (steps[i].type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE'
                    && steps[i].plannerResponse?.response) {
                    lastResponseText = steps[i].plannerResponse.response;
                    break;
                }
            }
            return {
                executorCount: (trajectory.executorMetadatas || []).length,
                lastResponseText,
            };
        } catch {
            return { executorCount: 0, lastResponseText: '' };
        }
    }

    async function pollResponse(timeoutMs, onUpdate, preExecutorCount, preResponseText) {
        const startTime = Date.now();
        let lastResponse = '';
        let lastResponseChangedAt = 0;
        let lastResponseStepDone = false;
        const STABLE_MS = 5000;
        const STUCK_MS = 60000;
        let lastActivityAt = Date.now();
        let prevExecutorCount = preExecutorCount;

        while (Date.now() - startTime < timeoutMs) {
            try {
                const res = await callRPC(port, csrfToken, 'GetCascadeTrajectory', {
                    cascadeId: getCascadeId(),
                    metadata: { ideName: 'antigravity' },
                });
                const trajectory = res?.trajectory || {};
                const steps = trajectory.steps || [];
                const executors = trajectory.executorMetadatas || [];

                let newResponseText = '';
                let lastPlannerStepDone = false;
                for (let i = steps.length - 1; i >= 0; i--) {
                    const step = steps[i];
                    if (step.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE'
                        && step.plannerResponse?.response) {
                        newResponseText = step.plannerResponse.response;
                        lastPlannerStepDone = step.status === 'CORTEX_STEP_STATUS_DONE';
                        break;
                    }
                }

                const isNewText = newResponseText && newResponseText !== preResponseText;
                if (executors.length > prevExecutorCount) {
                    lastActivityAt = Date.now();
                    prevExecutorCount = executors.length;
                }

                const isNewExecutorDone = executors.length > preExecutorCount
                    && !!executors[executors.length - 1]?.terminationReason;

                if (isNewExecutorDone && isNewText) {
                    return newResponseText;
                }
                if (isNewExecutorDone && !isNewText) {
                    preExecutorCount = executors.length;
                }

                if (isNewText && newResponseText !== lastResponse) {
                    lastResponse = newResponseText;
                    lastResponseChangedAt = Date.now();
                    lastResponseStepDone = lastPlannerStepDone;
                    if (onUpdate) onUpdate(newResponseText);
                } else if (isNewText && lastPlannerStepDone) {
                    lastResponseStepDone = true;
                }

                if (lastResponse && lastResponseStepDone && lastResponseChangedAt > 0
                    && Date.now() - lastResponseChangedAt >= STABLE_MS) {
                    return lastResponse;
                }
                if (lastResponse && lastResponseChangedAt > 0
                    && Date.now() - lastActivityAt >= STUCK_MS) {
                    return lastResponse + '\n\n⚠ AI 可能卡住了，請檢查 IDE。';
                }
            } catch (err) {
                console.error(`  Poll error: ${err.message}`);
            }
            await new Promise(r => setTimeout(r, 800));
        }
        if (lastResponse) return lastResponse;
        throw new Error('AI response timeout');
    }

    return { getTrajectorySnapshot, pollResponse };
}

// ============================================================
//  RPC Client
// ============================================================

export function createRpcClient(connection, options = {}) {
    let csrfToken = connection?.csrfToken;
    let port = connection?.port;
    let cascadeId = null;
    let cascadeStarted = false;
    let isFirstMessage = true;
    let useStreaming = true; // try streaming first, fallback to polling
    let activeStream = null; // current stream handle for cancel
    const systemPrompt = options.systemPrompt || '';

    async function startCascade() {
        cascadeId = randomUUID();
        cascadeStarted = false;
        console.log(`  New cascade: ${cascadeId.substring(0, 8)}...`);

        await callRPC(port, csrfToken, 'StartCascade', {
            cascadeId,
            metadata: { ideName: 'antigravity' },
        });

        cascadeStarted = true;
        return cascadeId;
    }

    async function sendMessage(text, model, mediaItems = null, memoryContext = '') {
        let fullText;
        if (isFirstMessage && systemPrompt) {
            const parts = ['[System Instructions]', systemPrompt];
            if (memoryContext) parts.push('', memoryContext);
            parts.push('[/System Instructions]', '', text);
            fullText = parts.join('\n');
        } else if (memoryContext && !isFirstMessage) {
            fullText = `${memoryContext}\n\n${text}`;
        } else {
            fullText = text;
        }
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

        if (mediaItems && mediaItems.length > 0) {
            payload.media = mediaItems;
        }

        await callRPC(port, csrfToken, 'SendUserCascadeMessage', payload);
    }

    // Stream-based AI response (primary method)
    // sentAt: timestamp when message was sent (used to ignore replay of old state)
    function streamResponse(timeoutMs, onUpdate, onPermission, sentAt = 0) {
        return new Promise((resolve, reject) => {
            let responseText = '';
            let done = false;
            let turnDoneDebounce = null;
            let replaySkipped = false; // 是否已跳過初始 replay
            const TURN_DONE_DELAY = 3000; // wait 3s after turnDone to collect stragglers
            const REPLAY_GRACE_MS = 2000; // 送出後 2 秒內的 turnDone 視為 replay

            const timeoutHandle = setTimeout(() => {
                if (!done) {
                    done = true;
                    if (activeStream) activeStream.abort();
                    if (responseText) {
                        resolve(responseText);
                    } else {
                        reject(new Error('AI response timeout'));
                    }
                }
            }, timeoutMs);

            function finish(text) {
                if (done) return;
                done = true;
                clearTimeout(timeoutHandle);
                if (turnDoneDebounce) clearTimeout(turnDoneDebounce);
                if (activeStream) { activeStream.abort(); activeStream = null; }
                resolve(text);
            }

            activeStream = streamFetch(port, csrfToken, 'StreamCascadeReactiveUpdates', {
                protocolVersion: 1,
                id: cascadeId,
                subscriberId: `bridge-${Date.now()}`,
            }, (frameJson) => {
                // onFrame callback
                const info = parseStreamFrame(frameJson);
                if (!info) return;

                // Accumulate response text
                if (info.response.length > 0) {
                    responseText = info.response.join('');
                    if (onUpdate) onUpdate(responseText);
                    // Reset turnDone debounce if text is still coming
                    if (turnDoneDebounce) {
                        clearTimeout(turnDoneDebounce);
                        turnDoneDebounce = null;
                    }
                }

                // Permission request
                if (info.permissionWait && onPermission) {
                    onPermission({
                        type: info.permissionWait,
                        trajectoryId: info.trajectoryId,
                        stepIndex: info.stepIndex,
                        path: info.permissionPath,
                        cmd: info.permissionCmd,
                    });
                }

                // Server error
                if (info.serverError) {
                    console.error(`  Server error: ${info.serverError.message || info.serverError.code}`);
                }

                // Turn done — debounce to collect any remaining frames
                if (info.turnDone) {
                    // 跳過初始 replay：送出訊息後太快收到的 turnDone 是舊回覆
                    if (sentAt && !replaySkipped && (Date.now() - sentAt) < REPLAY_GRACE_MS) {
                        console.log(`  ⏭️ Skipping replay turnDone (${Date.now() - sentAt}ms after send)`);
                        replaySkipped = true;
                        responseText = ''; // 清掉 replay 的舊文字
                        return;
                    }
                    if (turnDoneDebounce) clearTimeout(turnDoneDebounce);
                    turnDoneDebounce = setTimeout(() => {
                        if (responseText) {
                            console.log(`  Stream done (${responseText.length} chars)`);
                            finish(responseText);
                        }
                    }, TURN_DONE_DELAY);
                }
            }, (err) => {
                // onEnd callback
                if (done) return;
                if (err) {
                    console.error(`  Stream error: ${err.message}`);
                    if (!responseText) {
                        done = true;
                        clearTimeout(timeoutHandle);
                        reject(err);
                        return;
                    }
                }
                // Stream ended — return whatever we have
                if (responseText) {
                    console.log(`  Stream ended (${responseText.length} chars)`);
                    finish(responseText);
                }
            });
        });
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
            isFirstMessage = true;
            if (activeStream) { activeStream.abort(); activeStream = null; }
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

        // Restore cascade from saved session
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

        // ============================================================
        //  Main entry: send message and get AI response
        // ============================================================

        async sendToAI(message, model, onUpdate = null, timeoutMs = 120000, mediaItems = null, memoryContext = '', onPermission = null) {
            if (!csrfToken || !port) throw new Error('Not connected');

            if (!cascadeId || !cascadeStarted) {
                await startCascade();
            }

            try {
                const sentAt = Date.now();
                await sendMessage(message, model, mediaItems, memoryContext);

                if (useStreaming) {
                    try {
                        return await streamResponse(timeoutMs, onUpdate, onPermission, sentAt);
                    } catch (streamErr) {
                        // If streaming fails on first try, fallback to polling
                        console.warn(`  Streaming failed: ${streamErr.message}, falling back to polling`);
                        useStreaming = false;
                        // Message already sent, use polling to get response
                        const fallback = createPollingFallback(port, csrfToken, () => cascadeId);
                        const snap = await fallback.getTrajectorySnapshot();
                        return await fallback.pollResponse(timeoutMs, onUpdate, snap.executorCount, snap.lastResponseText);
                    }
                } else {
                    // Polling mode
                    const fallback = createPollingFallback(port, csrfToken, () => cascadeId);
                    const snap = await fallback.getTrajectorySnapshot();
                    return await fallback.pollResponse(timeoutMs, onUpdate, snap.executorCount, snap.lastResponseText);
                }
            } catch (err) {
                // Auto-recovery: if cascade is broken, reset and retry once
                if (err.message.includes('INTERNAL') || err.message.includes('cascade')
                    || err.message.includes('404') || err.message.includes('400')
                    || err.message.includes('500') || err.message.includes('terminated')) {
                    console.log('  Cascade error, auto-resetting...');
                    await startCascade();
                    const retrySentAt = Date.now();
                    await sendMessage(message, model, mediaItems, memoryContext);

                    if (useStreaming) {
                        return await streamResponse(timeoutMs, onUpdate, onPermission, retrySentAt);
                    } else {
                        const fallback = createPollingFallback(port, csrfToken, () => cascadeId);
                        const snap = await fallback.getTrajectorySnapshot();
                        return await fallback.pollResponse(timeoutMs, onUpdate, snap.executorCount, snap.lastResponseText);
                    }
                }
                throw err;
            }
        },

        // ============================================================
        //  Cancel running AI execution
        // ============================================================

        async cancelCascade() {
            if (!cascadeId) return false;
            try {
                // Abort active stream first
                if (activeStream) { activeStream.abort(); activeStream = null; }
                await callRPC(port, csrfToken, 'CancelCascadeInvocation', { cascadeId });
                console.log('  Cascade cancelled');
                return true;
            } catch (err) {
                console.error(`  Cancel error: ${err.message}`);
                return false;
            }
        },

        // ============================================================
        //  Permission handling (Allow/Deny tool calls)
        // ============================================================

        async handlePermission(trajectoryId, stepIndex, type, allow) {
            const interaction = { trajectoryId, stepIndex };

            switch (type) {
                case 'run_command':
                    interaction.runCommand = {
                        confirm: allow,
                        proposedCommandLine: '',
                        submittedCommandLine: '',
                    };
                    break;
                case 'file':
                    interaction.filePermission = {
                        allow,
                        scope: 'PERMISSION_SCOPE_CONVERSATION',
                        absolutePathUri: '',
                    };
                    break;
                case 'browser':
                    interaction.browserAction = { confirm: allow };
                    break;
                case 'mcp':
                    interaction.mcp = { confirm: allow };
                    break;
                default:
                    interaction.browserAction = { confirm: allow };
            }

            try {
                await callRPC(port, csrfToken, 'HandleCascadeUserInteraction', {
                    cascadeId,
                    interaction,
                });
                console.log(`  Permission ${allow ? 'allowed' : 'denied'} (${type})`);
                return true;
            } catch (err) {
                console.error(`  Permission error: ${err.message}`);
                return false;
            }
        },

        // ============================================================
        //  Cascade management
        // ============================================================

        async listCascades() {
            try {
                const res = await callRPC(port, csrfToken, 'GetAllCascadeTrajectories', {});
                return res?.trajectorySummaries || {};
            } catch (err) {
                console.error(`  List cascades error: ${err.message}`);
                return {};
            }
        },

        async deleteCascade(id) {
            try {
                await callRPC(port, csrfToken, 'DeleteCascadeTrajectory', { cascadeId: id });
                console.log(`  Deleted cascade: ${id.substring(0, 8)}...`);
                return true;
            } catch (err) {
                console.error(`  Delete cascade error: ${err.message}`);
                return false;
            }
        },
    };
}
