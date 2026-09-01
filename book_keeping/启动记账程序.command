#!/bin/zsh

# 双击 .command 时，macOS 启动的终端未必位于项目目录。
# 程序代码与用户数据分开存放：以后升级“程序文件”时，不会覆盖已经确认的异常记录。
ROOT_DIR="${0:A:h}"
PROGRAM_DIR="${ROOT_DIR}/程序源码"
USER_DATA_DIR="${ROOT_DIR}/用户数据"
cd "$PROGRAM_DIR" || {
  echo "没有找到“程序源码”文件夹，请不要把启动文件单独移出记账程序文件夹。"
  read "REPLY?按回车键关闭窗口…"
  exit 1
}
mkdir -p "$USER_DATA_DIR"

PORT="3765"
APP_URL="http://127.0.0.1:${PORT}"

# 如果程序已经启动，直接打开网页，避免重复占用同一个端口。除了 HTTP 成功外，
# 还校验服务名称，防止端口恰好被其他本地程序占用时误打开错误页面。
HEALTH_RESPONSE="$(/usr/bin/curl --silent --fail "${APP_URL}/api/health" 2>/dev/null)"
if [[ "$HEALTH_RESPONSE" == *'"service":"bookkeeping-local"'* ]]; then
  /usr/bin/open "$APP_URL"
  exit 0
fi

BUNDLED_NODE="${ROOT_DIR}/运行环境/Mac-x64/node"
if [[ -x "$BUNDLED_NODE" ]]; then
  NODE_BIN="$BUNDLED_NODE"
else
  NODE_BIN="$(command -v node 2>/dev/null)"
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "程序自带的运行环境不完整，无法启动。"
  echo "请重新复制完整的“记账程序”文件夹，不需要自行下载陌生软件。"
  echo
  read "REPLY?按回车键关闭窗口…"
  exit 1
fi

# 开发目录把代码和庞大的运行依赖分开放置。这个软链接只负责让 Node.js
# 按标准模块规则找到依赖，不复制第二份代码，也不会被打进 Windows 发布包。
if [[ ! -d "${PROGRAM_DIR}/node_modules" ]]; then
  echo "Mac 运行环境连接不完整，找不到 Excel 处理组件。"
  echo "请重新复制完整的 book_keeping 文件夹。"
  echo
  read "REPLY?按回车键关闭窗口…"
  exit 1
fi

# 先验证最重要的表格组件。若复制时漏掉隐藏文件或“程序文件”不完整，
# 在打开网页前就给出中文说明，避免用户处理到最后才看到复杂英文报错。
if ! "$NODE_BIN" -e 'import("@oai/artifact-tool")' 2>/dev/null; then
  echo "程序文件不完整，缺少 Excel 处理组件。"
  echo "请重新复制整个文件夹，不要只复制启动文件。"
  echo
  read "REPLY?按回车键关闭窗口…"
  exit 1
fi

echo "正在启动本地记账助手…"
echo "浏览器稍后会自动打开：${APP_URL}"
echo

BOOKKEEPING_USER_DATA_DIR="$USER_DATA_DIR" "$NODE_BIN" web/server.mjs --open

echo
read "REPLY?程序已停止，按回车键关闭窗口…"
