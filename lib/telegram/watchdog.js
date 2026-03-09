// lib/telegram/watchdog.js — 健康檢查 + 自動重連
// 斷線後前 2 分鐘每 5 秒重連，之後回 30 秒

export function setupWatchdog(ctx) {
    const { bot, rpc, reconnectFn } = ctx;

    let wasHealthy = rpc.connected;
    let disconnectCount = 0;
    let disconnectFirstAt = 0;
    const FAST_INTERVAL = 5000;    // 斷線後快速重試間隔
    const NORMAL_INTERVAL = 30000; // 正常檢查間隔
    const FAST_DURATION = 120000;  // 快速重試持續 2 分鐘

    function getInterval() {
        if (!wasHealthy && disconnectFirstAt > 0 && Date.now() - disconnectFirstAt < FAST_DURATION) {
            return FAST_INTERVAL;
        }
        return NORMAL_INTERVAL;
    }

    async function tick() {
        const ok = rpc.connected ? await rpc.healthCheck() : false;

        if (ok) {
            if (!wasHealthy) {
                console.log('  ✅ Watchdog: connection restored');
                if (ctx.lastKnownChatId) {
                    bot.sendMessage(ctx.lastKnownChatId, '✅ IDE 連線已恢復！').catch(() => {});
                }
                disconnectCount = 0;
                disconnectFirstAt = 0;
            }
            wasHealthy = true;
        } else {
            const now = Date.now();

            // First notification: immediate
            if (wasHealthy && disconnectCount === 0) {
                console.log('  ⚠ Watchdog: connection lost');
                if (ctx.lastKnownChatId) {
                    bot.sendMessage(ctx.lastKnownChatId, '⚠ IDE 連線中斷。開啟 Antigravity 後會自動重連。').catch(() => {});
                }
                disconnectCount = 1;
                disconnectFirstAt = now;
            }

            // Second notification: 5 minutes later
            if (disconnectCount === 1 && disconnectFirstAt > 0 && now - disconnectFirstAt >= 300000) {
                if (ctx.lastKnownChatId) {
                    bot.sendMessage(ctx.lastKnownChatId, '⚠ IDE 仍未連線。請確認 Antigravity 是否在執行。').catch(() => {});
                }
                disconnectCount = 2;
            }

            wasHealthy = false;

            // Silently try to reconnect
            const conn = await reconnectFn();
            if (conn) {
                rpc.updateConnection(conn);
                const verify = await rpc.healthCheck();
                if (verify) {
                    wasHealthy = true;
                    disconnectCount = 0;
                    disconnectFirstAt = 0;
                    console.log('  ✅ Watchdog: reconnected');
                    if (ctx.lastKnownChatId) {
                        bot.sendMessage(ctx.lastKnownChatId, '✅ IDE 已重新連線！').catch(() => {});
                    }
                }
            }
        }

        // 動態間隔：斷線時 5s，正常時 30s
        setTimeout(tick, getInterval());
    }

    setTimeout(tick, NORMAL_INTERVAL);
}
