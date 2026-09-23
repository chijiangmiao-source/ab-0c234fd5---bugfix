#!/bin/sh
# HTTP 冒烟：健康检查、首页、构建产物 JS 均须可达。纯 POSIX sh + busybox wget。
set -eu

BASE="${BASE_URL:-http://web}"

echo "[smoke] GET ${BASE}/healthz"
body="$(wget -q -O - "${BASE}/healthz")"
if [ "$body" != "ok" ]; then
  echo "[smoke] FAIL: /healthz 返回内容异常: '${body}'" >&2
  exit 1
fi

echo "[smoke] GET ${BASE}/"
index="$(wget -q -O - "${BASE}/")"
printf '%s' "$index" | grep -q '<div id="root"></div>'

asset="$(printf '%s' "$index" | sed -n 's/.*src="\([^"]*\.js\)".*/\1/p' | head -n 1)"
if [ -z "$asset" ]; then
  echo "[smoke] FAIL: 首页未引用 JS 构建产物" >&2
  exit 1
fi

echo "[smoke] GET ${BASE}${asset}"
wget -q -O /dev/null "${BASE}${asset}"

echo "[smoke] ALL CHECKS PASSED"
