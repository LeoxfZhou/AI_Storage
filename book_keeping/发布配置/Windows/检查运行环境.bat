@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "ROOT_DIR=%~dp0"
set "PROGRAM_DIR=%ROOT_DIR%程序文件"
set "NODE_BIN=%PROGRAM_DIR%\.runtime\node.exe"
set "RESULT_FILE=%ROOT_DIR%Windows运行环境检查结果.txt"
set "TEST_XLSX=%TEMP%\记账程序运行环境检查.xlsx"

> "%RESULT_FILE%" echo Windows 运行环境检查
>> "%RESULT_FILE%" echo 时间：%DATE% %TIME%
>> "%RESULT_FILE%" echo 系统：%OS%
>> "%RESULT_FILE%" echo 处理器：%PROCESSOR_IDENTIFIER%
>> "%RESULT_FILE%" echo 系统架构：%PROCESSOR_ARCHITECTURE%

if not exist "%NODE_BIN%" (
  >> "%RESULT_FILE%" echo 结果：失败，找不到 node.exe。
  goto :failed
)

pushd "%PROGRAM_DIR%" >nul
"%NODE_BIN%" -e "console.log('Node.js：'+process.version);console.log('平台：'+process.platform+' '+process.arch);import('@oai/artifact-tool').then(()=>console.log('Excel组件：载入成功')).catch(error=>{console.error(error);process.exit(1)})" >> "%RESULT_FILE%" 2>&1
if errorlevel 1 (
  popd >nul
  >> "%RESULT_FILE%" echo 结果：失败，Excel 组件无法载入。
  goto :failed
)

rem 真正生成一个临时 xlsx，能同时覆盖 Node、Windows 原生组件和 Excel 导出链路。
"%NODE_BIN%" prepare_data.mjs template --output "%TEST_XLSX%" >> "%RESULT_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

if not "%EXIT_CODE%"=="0" (
  >> "%RESULT_FILE%" echo 结果：失败，测试 Excel 无法生成。
  goto :failed
)

del "%TEST_XLSX%" >nul 2>nul
>> "%RESULT_FILE%" echo 结果：通过，可以正常使用。
echo 检查通过，可以正常使用记账程序。
echo 详细结果已保存在“Windows运行环境检查结果.txt”。
pause
exit /b 0

:failed
echo 检查未通过。请把“Windows运行环境检查结果.txt”发给程序维护者。
echo.
type "%RESULT_FILE%"
echo.
pause
exit /b 1
