// lib/telegram/ctx.js — 共享 context 物件
// 所有模組透過 ctx 存取 bot、config、rpc 及共享狀態

export function createContext(bot, config, rpc, reconnectFn) {
    return {
        bot,
        config,
        rpc,
        reconnectFn,

        // 訊息佇列狀態
        queue: [],
        processing: false,
        processingStartedAt: 0,
        lastKnownChatId: null,

        // processQueue 函式，由 queue.js 初始化後掛上
        processQueue: null,
    };
}
