#!/bin/bash
# Antigravity Bridge — 一鍵啟動
# 雙擊此檔案即可啟動
# Double-click this file to start

cd "$(dirname "$0")"

echo "=== Antigravity Bridge ==="
echo ""

# 0. 殺掉舊的 Bridge（避免 Telegram 409 衝突）
OLD_PIDS=$(ps aux | grep "node bridge.js" | grep -v grep | awk '{print $2}')
if [ -n "$OLD_PIDS" ]; then
    echo "⛔ 關閉舊 Bridge..."
    echo "$OLD_PIDS" | xargs kill 2>/dev/null
    sleep 2
fi

# 0.5 清除舊連線（避免 port 變更導致 timeout）
echo "🧹 清除舊連線資料..."
echo '{}' > data/session.json 2>/dev/null

# 讀取 .env 中的 PROJECT_PATH
PROJECT_PATH=""
if [ -f ".env" ]; then
    PROJECT_PATH=$(grep -E "^PROJECT_PATH=" .env | cut -d'=' -f2-)
fi

# 1. 確認 Antigravity 是否在跑，沒有就啟動
if ! ps aux | grep -v grep | grep -q "Antigravity.app"; then
    echo "Starting Antigravity IDE..."
    if [ -n "$PROJECT_PATH" ] && [ -d "$PROJECT_PATH" ]; then
        echo "Opening project: $PROJECT_PATH"
        open -a Antigravity "$PROJECT_PATH"
    else
        open -a Antigravity
        echo ""
        echo "⚠ No PROJECT_PATH set in .env"
        echo "  IDE will open to Launchpad — you need to manually open a project"
        echo "  for Language Server to start."
        echo ""
        echo "  To fix: add this line to .env:"
        echo "  PROJECT_PATH=/path/to/any/project/folder"
        echo ""
    fi
    echo "Waiting for IDE to load..."
    sleep 10
else
    # Antigravity 已在跑，但可能在 Launchpad（沒開專案）
    # 檢查 LS 是否已啟動
    if ! ps aux | grep -v grep | grep -q "csrf_token"; then
        echo "Antigravity is running but Language Server not detected."
        if [ -n "$PROJECT_PATH" ] && [ -d "$PROJECT_PATH" ]; then
            echo "Opening project: $PROJECT_PATH"
            open -a Antigravity "$PROJECT_PATH"
            sleep 5
        else
            echo ""
            echo "⚠ Please open a project in Antigravity to start Language Server."
            echo "  Or add PROJECT_PATH=/path/to/project to .env"
            echo ""
        fi
    fi
fi

# 2. 等 Language Server 啟動（最多等 60 秒）
echo "Waiting for Language Server..."
LS_READY=false
for i in $(seq 1 60); do
    if ps aux | grep -v grep | grep -q "csrf_token"; then
        echo "Language Server ready!"
        LS_READY=true
        break
    fi
    if [ $((i % 10)) -eq 0 ]; then
        echo "  Still waiting... (${i}s)"
    fi
    sleep 1
done

if [ "$LS_READY" = false ]; then
    echo ""
    echo "Language Server not detected after 60 seconds."
    echo "Bridge will start anyway — use /reconnect in Telegram after LS is ready."
    echo ""
fi

# 3. 安裝依賴（首次才需要）
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# 4. 檢查 .env
if [ ! -f ".env" ]; then
    echo ""
    echo "First time setup needed!"
    echo "首次使用，需要設定！"
    node scripts/setup.js
fi

# 5. 啟動 Bridge
echo ""
echo "Starting Bridge..."
exec node bridge.js
