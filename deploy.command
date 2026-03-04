#!/bin/bash
# Antigravity Bridge — 複製專案到目標路徑
# Deploy project to target path (excluding private files)
# 雙擊此檔案即可使用 / Double-click to use

cd "$(dirname "$0")"

echo "=== Antigravity Bridge Deploy ==="
echo ""
echo "此工具會將專案複製到你指定的目標路徑"
echo "This tool copies the project to your target path"
echo ""
echo "排除項目 Excluded: .env, node_modules, downloads, .DS_Store, *.log, __pycache__"
echo ""

# 讀取目標路徑
if [ -n "$1" ]; then
    TARGET="$1"
else
    echo "請輸入目標路徑 / Enter target path:"
    echo "  例 Example: /Volumes/USB/antigravity-bridge"
    echo ""
    read -p "> " TARGET
fi

if [ -z "$TARGET" ]; then
    echo "未輸入路徑，取消。/ No path given, cancelled."
    exit 1
fi

# 確認
echo ""
echo "來源 From: $(pwd)/"
echo "目標 To:   $TARGET/"
echo ""
read -p "確認複製？Continue? (y/N) " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "取消。Cancelled."
    exit 0
fi

# 執行 rsync
echo ""
echo "Copying..."
rsync -av --delete \
    --exclude='.env' \
    --exclude='node_modules' \
    --exclude='downloads' \
    --exclude='.DS_Store' \
    --exclude='*.log' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.git' \
    ./ "$TARGET/"

echo ""
echo "Done!"
echo ""
echo "下一步 Next steps:"
echo "  cd $TARGET"
echo "  npm install"
echo "  npm run setup      # 設定 .env (Bot Token 等)"
echo "  npm start"
echo ""
