#!/usr/bin/env node
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  applyReviewResolutions,
  buildReviewCollections,
  loadReviewState,
  mergeReviewDecisions,
  saveReviewState,
} from "../src/review.mjs";
import {
  buildRuleImprovementSamples,
  loadReviewHistory,
  recordReviewDecisions,
  restoreReviewDecisions,
  saveReviewHistoryFiles,
} from "../src/review_history.mjs";

const serverFile = fileURLToPath(import.meta.url);
const webDir = path.dirname(serverFile);
const defaultProjectDir = path.resolve(webDir, "..");

export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
const DOWNLOADABLE_FILES = new Set([
  "标准输入模板.xlsx",
  "标准化输入数据.xlsx",
  "记账分析报告.xlsx",
]);
const HISTORY_FILE_NAME = "异常处理进度.json";
const SAMPLE_FILE_NAME = "规则改进样本.json";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendText(response, statusCode, text) {
  const body = Buffer.from(text);
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": body.length,
  });
  response.end(body);
}

function decodeHeaderFileName(headerValue) {
  if (!headerValue) return "上传文件.xlsx";
  try {
    return decodeURIComponent(String(headerValue));
  } catch {
    return String(headerValue);
  }
}

export function isXlsxBuffer(buffer) {
  // xlsx 本质是 ZIP 文件。只检查扩展名并不够，因为误传图片或旧版 xls 时，
  // 后面的解析错误会非常难懂；先检查 ZIP 文件头可以给用户更明确的提示。
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export function createJobId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}-${randomBytes(3).toString("hex")}`;
}

export function parseJsonTail(output) {
  // 表格工具可能在最终 JSON 前打印检查日志，因此不能假定 stdout 只有 JSON。
  // 从最后一个独占行的“{”开始尝试，避免日志内容导致 JSON.parse 失败。
  const starts = [...output.matchAll(/(?:^|\n)(\{)/g)].map((match) => match.index + (match[0].startsWith("\n") ? 1 : 0));
  for (const start of starts.reverse()) {
    try {
      return JSON.parse(output.slice(start).trim());
    } catch {
      // 继续尝试更前面的候选位置；全部失败时由调用方返回空对象。
    }
  }
  return {};
}

async function readRequestBody(request, maxBytes = MAX_UPLOAD_BYTES) {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > maxBytes) {
    const error = new Error("文件超过 80 MB，请先精简工作簿后再上传");
    error.statusCode = 413;
    throw error;
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      const error = new Error("文件超过 80 MB，请先精简工作簿后再上传");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function runNodeScript(projectDir, scriptName, args) {
  return new Promise((resolve, reject) => {
    // process.execPath 保证子程序和网页服务使用同一个 Node.js，避免双击启动时
    // 系统 PATH 与终端 PATH 不一致，出现“网页能开但处理程序找不到 Node”的问题。
    const child = spawn(process.execPath, [path.join(projectDir, scriptName), ...args], {
      cwd: projectDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(parseJsonTail(stdout));
        return;
      }
      const details = stderr.trim() || stdout.trim() || `退出码 ${code}`;
      reject(new Error(details.slice(-4000)));
    });
  });
}

async function sendStaticFile(response, publicDir, relativePath) {
  const safeRelativePath = relativePath === "/" ? "index.html" : relativePath.replace(/^\/+/, "");
  const resolvedPath = path.resolve(publicDir, safeRelativePath);

  // path.resolve 后再验证前缀，阻止通过 ../../ 读取项目中的流水或其他本地文件。
  if (!resolvedPath.startsWith(`${path.resolve(publicDir)}${path.sep}`)) {
    sendText(response, 403, "禁止访问");
    return;
  }

  try {
    const file = await fs.readFile(resolvedPath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(resolvedPath)] ?? "application/octet-stream",
      "Content-Length": file.length,
      "Cache-Control": "no-cache",
    });
    response.end(file);
  } catch (error) {
    sendText(response, error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "页面不存在" : "读取页面失败");
  }
}

async function sendDownload(response, runsDir, jobId, fileName) {
  if (!/^[A-Za-z0-9-]+$/.test(jobId) || !DOWNLOADABLE_FILES.has(fileName)) {
    sendText(response, 404, "文件不存在");
    return;
  }

  const jobDir = path.resolve(runsDir, jobId);
  const filePath = path.resolve(jobDir, fileName);
  if (!filePath.startsWith(`${jobDir}${path.sep}`)) {
    sendText(response, 403, "禁止访问");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    response.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    sendText(response, error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "文件不存在" : "下载失败");
  }
}

async function sendRuleSamples(response, historyPath, samplesPath) {
  try {
    // 历史文件可能还没有任何记录。此时仍导出一个结构完整的空样本文件，
    // 用户能确认按钮正常工作，也不会因为“没有数据”得到难懂的 404。
    const history = await loadReviewHistory(historyPath);
    const samples = buildRuleImprovementSamples(history);
    await saveReviewHistoryFiles({ historyPath, samplesPath, history });
    const body = Buffer.from(`${JSON.stringify(samples, null, 2)}\n`);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(SAMPLE_FILE_NAME)}`,
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch (error) {
    sendText(response, 500, `导出规则改进样本失败：${error.message}`);
  }
}

function safeJobDirectory(runsDir, jobId) {
  if (!/^[A-Za-z0-9-]+$/.test(String(jobId ?? ""))) return null;
  const root = path.resolve(runsDir);
  const jobDir = path.resolve(root, jobId);
  return jobDir.startsWith(`${root}${path.sep}`) ? jobDir : null;
}

async function readJsonRequest(request, maxBytes = 5 * 1024 * 1024) {
  const body = await readRequestBody(request, maxBytes);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    const error = new Error("请求内容不是有效的 JSON");
    error.statusCode = 400;
    throw error;
  }
}

export function createBookkeepingServer(options = {}) {
  const projectDir = path.resolve(options.projectDir ?? defaultProjectDir);
  const publicDir = path.resolve(options.publicDir ?? path.join(projectDir, "web", "public"));
  const runsDir = path.resolve(options.runsDir ?? path.join(projectDir, "runs"));
  const defaultUserDataDir = path.basename(projectDir) === "程序文件"
    ? path.join(projectDir, "..", "用户数据")
    : path.join(projectDir, "用户数据");
  const userDataDir = path.resolve(
    options.userDataDir ?? process.env.BOOKKEEPING_USER_DATA_DIR ?? defaultUserDataDir,
  );
  const historyPath = path.join(userDataDir, HISTORY_FILE_NAME);
  const samplesPath = path.join(userDataDir, SAMPLE_FILE_NAME);
  const scriptRunner = options.scriptRunner ?? ((scriptName, args) => runNodeScript(projectDir, scriptName, args));

  // 表格生成比较吃内存。用队列串行处理可以防止用户连续点击两次后同时生成多份
  // 工作簿，避免本地电脑卡死；等待中的请求仍会正常完成。
  let processingQueue = Promise.resolve();
  const enqueue = (task) => {
    const result = processingQueue.then(task, task);
    processingQueue = result.catch(() => undefined);
    return result;
  };

  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, service: "bookkeeping-local" });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname.startsWith("/downloads/")) {
      const parts = requestUrl.pathname.split("/").filter(Boolean);
      if (parts.length !== 3) {
        sendText(response, 404, "文件不存在");
        return;
      }
      await sendDownload(response, runsDir, parts[1], decodeURIComponent(parts[2]));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/review/export-samples") {
      await sendRuleSamples(response, historyPath, samplesPath);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/template") {
      try {
        const result = await enqueue(async () => {
          const jobId = createJobId();
          const jobDir = path.join(runsDir, jobId);
          const outputPath = path.join(jobDir, "标准输入模板.xlsx");
          await fs.mkdir(jobDir, { recursive: true });
          await scriptRunner("prepare_data.mjs", ["template", "--output", outputPath]);
          return {
            jobId,
            files: [{ name: "标准输入模板.xlsx", url: `/downloads/${jobId}/${encodeURIComponent("标准输入模板.xlsx")}` }],
          };
        });
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(response, 500, { ok: false, message: "模板生成失败", details: error.message });
      }
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/inspect") {
      try {
        const originalName = decodeHeaderFileName(request.headers["x-file-name"]);
        if (!originalName.toLowerCase().endsWith(".xlsx")) {
          const error = new Error("请选择 .xlsx 格式的 Excel 文件");
          error.statusCode = 400;
          throw error;
        }
        const upload = await readRequestBody(request);
        if (!isXlsxBuffer(upload)) {
          const error = new Error("文件内容不是有效的 .xlsx 工作簿");
          error.statusCode = 400;
          throw error;
        }

        const result = await enqueue(async () => {
          const jobId = createJobId();
          const jobDir = path.join(runsDir, jobId);
          const uploadPath = path.join(jobDir, "上传文件.xlsx");
          await fs.mkdir(jobDir, { recursive: true });
          await fs.writeFile(uploadPath, upload);
          const inspection = await scriptRunner("inspect_workbook.mjs", ["--input", uploadPath]);
          return { jobId, ...inspection };
        });
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        const statusCode = error.statusCode ?? 500;
        sendJson(response, statusCode, { ok: false, message: error.message });
      }
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/process") {
      try {
        const payload = await readJsonRequest(request);
        const { jobId, mode } = payload;
        if (!new Set(["legacy", "standard", "pipeline"]).has(mode)) {
          const error = new Error("请选择正确的处理模式");
          error.statusCode = 400;
          throw error;
        }
        const jobDir = safeJobDirectory(runsDir, jobId);
        if (!jobDir) {
          const error = new Error("任务编号无效，请重新选择文件");
          error.statusCode = 400;
          throw error;
        }

        const result = await enqueue(async () => {
          const uploadPath = path.join(jobDir, "上传文件.xlsx");
          await fs.access(uploadPath);

          if (["legacy", "pipeline"].includes(mode)) {
            const selectedSheets = Array.isArray(payload.selectedSheets) ? payload.selectedSheets : [];
            if (selectedSheets.length === 0) {
              const error = new Error("请至少选择一个需要导入的工作表");
              error.statusCode = 400;
              throw error;
            }
            const standardPath = path.join(jobDir, "标准化输入数据.xlsx");
            const reviewStatePath = path.join(jobDir, "review-state.json");
            let standardSummary = await scriptRunner("prepare_data.mjs", [
              "migrate", "--input", uploadPath, "--output", standardPath,
              "--sheets-json", JSON.stringify(selectedSheets), "--review-json", reviewStatePath,
            ]);
            const reconciliationChecks = standardSummary.reconciliationChecks ?? 0;
            let reviewState = await loadReviewState(reviewStatePath);
            reviewState.workflowMode = mode;
            await saveReviewState(reviewStatePath, reviewState);

            // 新任务生成异常组后，用原始内容指纹恢复本机历史决定。只有工作表、
            // 单元格和原文完全相同才会匹配，因此旧答案不会误套到已修改的流水。
            const history = await loadReviewHistory(historyPath);
            const restoredDecisions = restoreReviewDecisions(reviewState.sourceRecords, history);
            if (restoredDecisions.length > 0) {
              const restoredPath = path.join(jobDir, "review-restored.json");
              await fs.writeFile(restoredPath, JSON.stringify(restoredDecisions, null, 2));
              standardSummary = await scriptRunner("resolve_review.mjs", [
                "--state", reviewStatePath,
                "--resolutions", restoredPath,
                "--output", standardPath,
              ]);
              reviewState = await loadReviewState(reviewStatePath);
            }
            const reviewCollections = buildReviewCollections(reviewState);
            const files = [{ name: "标准化输入数据.xlsx", url: `/downloads/${jobId}/${encodeURIComponent("标准化输入数据.xlsx")}` }];
            if (mode === "pipeline") {
              const reportPath = path.join(jobDir, "记账分析报告.xlsx");
              await scriptRunner("generate_report.mjs", ["--input", standardPath, "--output", reportPath]);
              files.push({ name: "记账分析报告.xlsx", url: `/downloads/${jobId}/${encodeURIComponent("记账分析报告.xlsx")}` });
            }
            return {
              jobId,
              mode,
              selectedSheets,
              summary: {
                records: standardSummary.records ?? 0,
                statusCounts: standardSummary.statusCounts ?? {},
                reconciliationChecks,
              },
              restoredReviewCount: restoredDecisions.length,
              savedReviewCount: history.entries.length,
              ruleSampleCount: buildRuleImprovementSamples(history).sampleCount,
              ...reviewCollections,
              files,
            };
          }

          const reportPath = path.join(jobDir, "记账分析报告.xlsx");
          const reportSummary = await scriptRunner("generate_report.mjs", [
            "--input", uploadPath, "--output", reportPath,
          ]);
          return {
            jobId,
            mode,
            summary: {
              records: reportSummary.records ?? 0,
              statusCounts: reportSummary.statusCounts ?? {},
              reconciliationChecks: reportSummary.reconciliationChecks ?? 0,
            },
            reviewGroups: [],
            processedGroups: [],
            files: [{ name: "记账分析报告.xlsx", url: `/downloads/${jobId}/${encodeURIComponent("记账分析报告.xlsx")}` }],
          };
        });
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        const statusCode = error.statusCode ?? (error.code === "ENOENT" ? 404 : 500);
        sendJson(response, statusCode, {
          ok: false,
          message: statusCode >= 500 ? "处理失败，请确认上传的是对应格式的 Excel 文件" : error.message,
          details: statusCode >= 500 ? error.message : undefined,
        });
      }
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/review/autosave") {
      try {
        const payload = await readJsonRequest(request);
        const jobDir = safeJobDirectory(runsDir, payload.jobId);
        if (!jobDir) {
          const error = new Error("任务编号无效，请重新处理文件");
          error.statusCode = 400;
          throw error;
        }
        const result = await enqueue(async () => {
          const statePath = path.join(jobDir, "review-state.json");
          const state = await loadReviewState(statePath);
          const updates = Array.isArray(payload.resolutions) ? payload.resolutions : [];
          state.reviewDecisions = mergeReviewDecisions(state.reviewDecisions, updates);
          // 先走一次与正式生成相同的服务端校验，防止旧网页或手工请求把缺少
          // 人员、金额为 0 等不完整内容保存成“正确答案”样本。
          applyReviewResolutions(state.sourceRecords, state.reviewDecisions);

          // 自动保存只更新轻量 JSON，不重新生成 Excel。这样用户每处理一条都能
          // 立即落盘，同时不会因两份大工作簿反复计算而让页面卡顿。
          await saveReviewState(statePath, state);
          const saved = await recordReviewDecisions({
            sourceRecords: state.sourceRecords,
            decisions: state.reviewDecisions,
            historyPath,
            samplesPath,
          });
          return { ...saved, decisionCount: state.reviewDecisions.length };
        });
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        const statusCode = error.statusCode ?? (error.code === "ENOENT" ? 404 : 500);
        sendJson(response, statusCode, {
          ok: false,
          message: "异常处理进度自动保存失败",
          details: error.message,
        });
      }
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/review/resolve") {
      try {
        const payload = await readJsonRequest(request);
        const jobDir = safeJobDirectory(runsDir, payload.jobId);
        if (!jobDir) {
          const error = new Error("任务编号无效，请重新处理文件");
          error.statusCode = 400;
          throw error;
        }
        const result = await enqueue(async () => {
          const statePath = path.join(jobDir, "review-state.json");
          const resolutionsPath = path.join(jobDir, "review-resolutions.json");
          const outputPath = path.join(jobDir, "标准化输入数据.xlsx");
          await fs.writeFile(resolutionsPath, JSON.stringify(payload.resolutions ?? [], null, 2));
          const summary = await scriptRunner("resolve_review.mjs", [
            "--state", statePath, "--resolutions", resolutionsPath, "--output", outputPath,
          ]);
          const state = await loadReviewState(statePath);
          const saved = await recordReviewDecisions({
            sourceRecords: state.sourceRecords,
            decisions: state.reviewDecisions,
            historyPath,
            samplesPath,
          });
          const reviewCollections = buildReviewCollections(state);
          const files = [{ name: "标准化输入数据.xlsx", url: `/downloads/${payload.jobId}/${encodeURIComponent("标准化输入数据.xlsx")}` }];
          if (state.workflowMode === "pipeline") {
            const reportPath = path.join(jobDir, "记账分析报告.xlsx");
            await scriptRunner("generate_report.mjs", ["--input", outputPath, "--output", reportPath]);
            files.push({ name: "记账分析报告.xlsx", url: `/downloads/${payload.jobId}/${encodeURIComponent("记账分析报告.xlsx")}` });
          }
          return {
            jobId: payload.jobId,
            summary: {
              records: summary.records ?? 0,
              statusCounts: summary.statusCounts ?? {},
            },
            savedReviewCount: saved.progressCount,
            ruleSampleCount: saved.sampleCount,
            reviewSavedAt: saved.savedAt,
            ...reviewCollections,
            files,
          };
        });
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        const statusCode = error.statusCode ?? 500;
        sendJson(response, statusCode, { ok: false, message: "异常处理保存失败", details: error.message });
      }
      return;
    }

    if (request.method === "GET") {
      await sendStaticFile(response, publicDir, requestUrl.pathname);
      return;
    }

    sendJson(response, 404, { ok: false, message: "接口不存在" });
  });
}

async function startServer() {
  const port = Number(process.env.BOOKKEEPING_PORT ?? 3765);
  const host = "127.0.0.1";
  await fs.mkdir(path.join(defaultProjectDir, "runs"), { recursive: true });
  const server = createBookkeepingServer();

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`端口 ${port} 已被占用。记账程序可能已经启动，请打开 http://${host}:${port}`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    console.log(`\n记账程序已启动：${url}`);
    console.log("关闭这个终端窗口即可停止程序。\n");

    if (process.argv.includes("--open")) {
      // 双平台共用同一份服务端代码，但“打开默认浏览器”的系统命令不同。
      // Windows 使用 cmd.exe 的 start，macOS 使用 open；如果这里只支持 Mac，
      // Windows 便携包虽然能启动服务，非技术用户却只会看到一个黑色窗口。
      const opener = process.platform === "win32"
        ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "start", "", url], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          })
        : spawn("open", [url], { detached: true, stdio: "ignore" });

      // 打开浏览器只是便利功能，不应决定记账服务能否继续运行。
      // 例如浏览器命令被安全软件拦截时，用户仍可手动访问本地地址。
      opener.on("error", () => undefined);
      opener.unref();
    }
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === serverFile;
if (isMainModule) await startServer();
