import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBookkeepingServer, isXlsxBuffer, parseJsonTail } from "../web/server.mjs";
import { createRecord } from "../src/core.mjs";
import { saveReviewState } from "../src/review.mjs";

test("xlsx 文件头校验会拒绝普通文本", () => {
  assert.equal(isXlsxBuffer(Buffer.from("not an xlsx")), false);
  assert.equal(isXlsxBuffer(Buffer.from([0x50, 0x4b, 0x03, 0x04])), true);
});

test("可以从表格工具日志末尾读取程序摘要", () => {
  const output = 'Inspect result written to file: example\n{\n  "records": 12,\n  "statusCounts": {"有效": 10}\n}\n';
  assert.deepEqual(parseJsonTail(output), { records: 12, statusCounts: { 有效: 10 } });
});

test("本地服务提供健康检查并拒绝错误文件格式", async (context) => {
  const runsDir = await fs.mkdtemp(path.join(os.tmpdir(), "bookkeeping-web-test-"));
  const userDataDir = path.join(runsDir, "user-data");
  const server = createBookkeepingServer({ runsDir, userDataDir });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await fs.rm(runsDir, { recursive: true, force: true });
    // 部分代码执行沙盒完全禁止监听端口。这不代表服务实现有问题，
    // 因此只在明确的权限错误下跳过；其他错误仍然让测试失败。
    if (["EPERM", "EACCES"].includes(error.code)) {
      context.skip("当前测试环境禁止监听本机端口");
      return;
    }
    throw error;
  }
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(runsDir, { recursive: true, force: true });
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);

  const invalidResponse = await fetch(`${baseUrl}/api/inspect`, {
    method: "POST",
    headers: { "X-File-Name": encodeURIComponent("错误文件.txt") },
    body: "hello",
  });
  assert.equal(invalidResponse.status, 400);
  assert.match((await invalidResponse.json()).message, /\.xlsx/);

  const source = createRecord({
    recordId: "WEB-H1", groupId: "WEB-HG1", dateInfo: { date: null, reason: "日期待确认" },
    person: "周", account: "人民币账户", type: "支出", direction: "流出", amount: 12,
    currency: "CNY", category: "餐饮", status: "待确认", originalDescription: "饭费12",
    sourceSheet: "厂收支明细", sourceCell: "C12",
  });
  const jobId = "autosave-job";
  const jobDir = path.join(runsDir, jobId);
  await fs.mkdir(jobDir, { recursive: true });
  await saveReviewState(path.join(jobDir, "review-state.json"), { records: [source] });

  const autosaveResponse = await fetch(`${baseUrl}/api/review/autosave`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobId,
      resolutions: [{
        groupId: "WEB-HG1", action: "confirm",
        rows: [{ date: "2026-08-24", person: "周", amount: -12, transactionType: "支出", category: "餐饮", note: "饭费12" }],
      }],
    }),
  });
  const autosave = await autosaveResponse.json();
  assert.equal(autosave.ok, true);
  assert.equal(autosave.sampleCount, 1);
  assert.equal((await fs.stat(path.join(userDataDir, "异常处理进度.json"))).isFile(), true);

  const exportResponse = await fetch(`${baseUrl}/api/review/export-samples`);
  const exported = await exportResponse.json();
  assert.equal(exported.sampleCount, 1);
  assert.equal(exported.samples[0].trueValue[0].amount, -12);
});
