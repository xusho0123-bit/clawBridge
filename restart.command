#!/bin/bash
# ClawBridge — 一鍵重啟全部（OpenClaw + Antigravity + Bridge）
# 雙擊此檔案即可重啟所有服務

cd "$(dirname "$0")"

echo ""
echo "============================================"
echo "   ClawBridge 全部重啟"
echo "   OpenClaw + Antigravity + Bridge"
echo "============================================"
echo ""

# 讀取 .env 中的 PROJECT_PATH
PROJECT_PATH=""
if [ -f ".env" ]; then
    PROJECT_PATH=$(grep -E "^PROJECT_PATH=" .env | cut -d'=' -f2-)
fi

# === 1. 關閉 Bridge ===
echo "⛔ [1/5] 關閉 Bridge..."
OLD_PIDS=$(ps aux | grep "node bridge.js" | grep -v grep | awk '{print $2}')
if [ -n "$OLD_PIDS" ]; then
    echo "$OLD_PIDS" | xargs kill 2>/dev/null
    echo "   已關閉 Bridge"
else
    echo "   Bridge 沒在跑"
fi

# === 2. 關閉 Antigravity ===
echo "⛔ [2/5] 關閉 Antigravity IDE..."
if ps aux | grep -v grep | grep -q "Antigravity.app"; then
    osascript -e 'quit app "Antigravity"' 2>/dev/null
    sleep 3
    # 如果還沒關，強制殺
    if ps aux | grep -v grep | grep -q "Antigravity.app"; then
        pkill -f "Antigravity.app"
        sleep 2
    fi
    echo "   已關閉 Antigravity"
else
    echo "   Antigravity 沒在跑"
fi

# === 3. 關閉 OpenClaw ===
echo "⛔ [3/5] 關閉 OpenClaw..."
CLAW_PID=$(ps aux | grep "openclaw-gateway" | grep -v grep | awk '{print $2}')
if [ -n "$CLAW_PID" ]; then
    kill $CLAW_PID 2>/dev/null
    sleep 1
    echo "   已關閉 OpenClaw"
else
    echo "   OpenClaw 沒在跑"
fi

# === 4. 清除舊連線 ===
echo "🧹 [4/5] 清除舊連線..."
echo '{}' > data/session.json 2>/dev/null
echo "   session 已清除"

# === 5. 依序重啟 ===
echo ""
echo "🚀 [5/5] 重新啟動..."
echo ""

# 5a. 啟動 OpenClaw
echo "   啟動 OpenClaw..."
nohup openclaw-gateway > /dev/null 2>&1 &
sleep 2
if ps aux | grep -v grep | grep -q "openclaw-gateway"; then
    echo "   ✅ OpenClaw 已啟動"
else
    echo "   ⚠️  OpenClaw 啟動失敗（可能需要手動啟動）"
fi

# 5b. 啟動 Antigravity
echo "   啟動 Antigravity IDE..."
if [ -n "$PROJECT_PATH" ] && [ -d "$PROJECT_PATH" ]; then
    open -a Antigravity "$PROJECT_PATH"
    echo "   開啟專案: $PROJECT_PATH"
else
    open -a Antigravity
    echo "   ⚠️  沒有設定 PROJECT_PATH，請手動開專案"
fi

# 5c. 等 Language Server 啟動
echo "   等待 Language Server..."
LS_READY=false
for i in $(seq 1 60); do
    if ps aux | grep -v grep | grep -q "language_server"; then
        echo "   ✅ Language Server 已啟動 (${i}s)"
        LS_READY=true
        break
    fi
    if [ $((i % 10)) -eq 0 ]; then
        echo "   等待中... (${i}s)"
    fi
    sleep 1
done

if [ "$LS_READY" = false ]; then
    echo "   ⚠️  Language Server 60 秒內未偵測到"
    echo "   Bridge 會先啟動，可用 /reconnect 重連"
fi

# 5d. 啟動 Bridge
echo ""
echo "============================================"
echo "   ✅ 啟動 Bridge"
echo "============================================"
echo ""
exec node bridge.js
