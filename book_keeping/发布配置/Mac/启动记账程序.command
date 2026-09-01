#!/bin/zsh

# 双击启动时，终端当前目录未必是程序所在目录，所以所有路径都从本文件计算。
ROOT_DIR="${0:A:h}"
PROGRAM_DIR="${ROOT_DIR}/程序文件"
USER_DATA_DIR="${ROOT_DIR}/用户数据"
NODE_BIN="${PROGRAM_DIR}/.runtime/node"
PORT="3765"
APP_URL="http://127.0.0.1:${PORT}"

cd "$PROGRAM_DIR" || {
  echo "程序文件不完整。请重新解压整个 Mac 版，不要只复制启动文件。"
  read "REPLY?按回车键关闭窗口…"
  exit 1
}
mkdir -p "$USER_DATA_DIR"

HEALTH_RESPONSE="$(/usr/bin/curl --silent --fail "${APP_URL}/api/health" 2>/dev/null)"
if [[ "$HEALTH_RESPONSE" == *'"service":"bookkeeping-local"'* ]]; then
  /usr/bin/open "$APP_URL"
  exit 0
fi

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Mac 运行环境不完整。请重新解压整个程序。"
  read "REPLY?按回车键关闭窗口…"
  exit 1
fi

if ! "$NODE_BIN" -e 'import("@oai/artifact-tool")' 2>/dev/null; then
  echo "缺少 Excel 处理组件。请重新解压整个程序。"
  read "REPLY?按回车键关闭窗口…"
  exit 1
fi

echo "正在启动本地记账助手，浏览器稍后会自动打开…"
BOOKKEEPING_USER_DATA_DIR="$USER_DATA_DIR" BOOKKEEPING_PORT="$PORT" "$NODE_BIN" web/server.mjs --open

echo
read "REPLY?程序已停止，按回车键关闭窗口…"
