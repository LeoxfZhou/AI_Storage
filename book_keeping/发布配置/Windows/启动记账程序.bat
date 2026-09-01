@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

rem 所有路径都从批处理文件所在文件夹计算，因此整个程序可以放在桌面、U盘或中文路径。
set "ROOT_DIR=%~dp0"
set "PROGRAM_DIR=%ROOT_DIR%程序文件"
set "USER_DATA_DIR=%ROOT_DIR%用户数据"
set "NODE_BIN=%PROGRAM_DIR%\.runtime\node.exe"
set "LOG_FILE=%ROOT_DIR%启动错误日志.txt"
set "BOOKKEEPING_PORT=3765"
set "APP_URL=http://127.0.0.1:%BOOKKEEPING_PORT%"

if not exist "%USER_DATA_DIR%" mkdir "%USER_DATA_DIR%"

rem 如果服务已在运行，直接打开网页。这样重复双击不会产生端口占用错误。
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-RestMethod -UseBasicParsing -TimeoutSec 2 '%APP_URL%/api/health'; if($r.service -eq 'bookkeeping-local'){exit 0} } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  start "" "%APP_URL%"
  exit /b 0
)

> "%LOG_FILE%" echo 本地记账助手启动检查
>> "%LOG_FILE%" echo 时间：%DATE% %TIME%
>> "%LOG_FILE%" echo 程序目录：%PROGRAM_DIR%

if not exist "%NODE_BIN%" (
  >> "%LOG_FILE%" echo 错误：找不到 Windows x64 Node.js。
  goto :failed
)
if not exist "%PROGRAM_DIR%\web\server.mjs" (
  >> "%LOG_FILE%" echo 错误：找不到网页服务程序。
  goto :failed
)

pushd "%PROGRAM_DIR%" >nul

rem 在打开网页前验证最重要的原生 Excel 组件。文件复制不完整或平台装错时，
rem 用户会立即得到中文错误日志，而不是处理到最后才看到难懂的英文异常。
"%NODE_BIN%" -e "import('@oai/artifact-tool').then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1)})" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  popd >nul
  >> "%LOG_FILE%" echo 错误：Excel 处理组件无法载入。
  goto :failed
)

set "BOOKKEEPING_USER_DATA_DIR=%USER_DATA_DIR%"
echo 正在启动本地记账助手，浏览器稍后会自动打开……
echo 使用期间请不要关闭这个窗口。
echo.

"%NODE_BIN%" web\server.mjs --open >> "%LOG_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

if not "%EXIT_CODE%"=="0" (
  >> "%LOG_FILE%" echo 错误：服务异常停止，退出码 %EXIT_CODE%。
  goto :failed
)
exit /b 0

:failed
echo.
echo 程序没有成功启动。请把“启动错误日志.txt”发给程序维护者。
echo.
type "%LOG_FILE%"
echo.
pause
exit /b 1
