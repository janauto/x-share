#!/usr/bin/env bash
# 把扩展打包成可分发 / 可上传 Chrome Web Store 的 zip。
# 本扩展是纯 JS，无需编译；此脚本只做「收集需要的文件 → 压缩」。
# 用法：bash scripts/package.sh   （产物：dist/x-share-v<版本>.zip）
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(grep -m1 '"version"' manifest.json | sed -E 's/.*"version"[^"]*"([^"]+)".*/\1/')
OUT="dist/x-share-v${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

# 只打包运行必需的文件（不含 dist/、scripts/、.git 等）
zip -r -X "$OUT" \
  manifest.json \
  LICENSE \
  README.md \
  icons \
  src \
  vendor \
  -x '*.DS_Store' >/dev/null

COUNT=$(unzip -l "$OUT" | awk 'NR>3 && $4!="" {print $4}' | grep -v '/$' | wc -l | tr -d ' ')
SIZE=$(du -h "$OUT" | cut -f1)
echo "✅ 已生成 $OUT （${COUNT} 个文件，${SIZE}）"
