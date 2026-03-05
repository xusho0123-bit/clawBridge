#!/bin/bash
# ClawBridge — 一鍵重啟（清除舊連線）
# 雙擊此檔案即可重啟

cd "$(dirname "$0")"

echo ""
echo "=== ClawBridge 重啟 ==="
echo ""

# 1. 殺掉所有舊的 Bridge
OLD_PIDS=$(ps aux | grep "node bridge.js" | grep -v grep | awk '{print $2}')
if [ -n "$OLD_PIDS" ]; then
    echo "⛔ 關閉舊 Bridge..."
    echo "$OLD_PIDS" | xargs kill 2>/dev/null
    sleep 2
    echo "   已關閉 (PID: $OLD_PIDS)"
else
    echo "   沒有舊 Bridge 在跑"
fi

# 2. 清除舊的 session（cascade ID + port 快取）
echo "🧹 清除舊連線資料..."
echo '{}' > data/session.json 2>/dev/null
echo "   session.json 已清除"

# 3. 確認 Antigravity IDE 有在跑
if ! ps aux | grep -v grep | grep -q "Antigravity.app"; then
    echo ""
    echo "⚠️  Antigravity IDE 沒有在跑！"
    echo "   請先開啟 Antigravity IDE 並打開一個專案資料夾"
    echo ""
    read -p "按 Enter 繼續啟動（或 Ctrl+C 取消）..."
fi

# 4. 啟動新 Bridge
echo ""
echo "🚀 啟動 Bridge..."
echo ""
exec node bridge.js
