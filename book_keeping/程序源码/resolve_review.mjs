#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { getArg, markDuplicates } from "./src/core.mjs";
import {
  applyReviewResolutions,
  buildReviewCollections,
  loadReviewState,
  mergeReviewDecisions,
  saveReviewState,
} from "./src/review.mjs";
import { buildStandardWorkbook, saveWorkbook } from "./src/standard_workbook.mjs";

const args = process.argv.slice(2);
const stateArg = getArg(args, "--state", null);
const resolutionsArg = getArg(args, "--resolutions", null);
const outputArg = getArg(args, "--output", null);
if (!stateArg || !resolutionsArg || !outputArg) {
  throw new Error("需要 --state、--resolutions 和 --output 参数");
}
const statePath = path.resolve(stateArg);
const resolutionsPath = path.resolve(resolutionsArg);
const outputPath = path.resolve(outputArg);

const state = await loadReviewState(statePath);
const resolutions = JSON.parse(await fs.readFile(resolutionsPath, "utf8"));
const reviewDecisions = mergeReviewDecisions(state.reviewDecisions, resolutions);

// 每次都从 sourceRecords 重新应用全部决定，才能安全支持“确认 → 忽略”、
// “忽略 → 暂不处理”等反复修改，而不会在已经拆分过的数据上再次拆分。
const records = markDuplicates(applyReviewResolutions(state.sourceRecords, reviewDecisions));
const workbook = buildStandardWorkbook({
  records,
  logs: state.logs,
  reconciliation: state.reconciliation,
  sourceFile: state.sourceFile,
});
await saveWorkbook(workbook, outputPath);

// 把确认结果写回状态文件。用户分批处理异常时，下一次操作会基于最新记录，
// 不会把前一次已经确认的内容恢复成旧值。
const nextState = { ...state, records, reviewDecisions };
await saveReviewState(statePath, nextState);
const statusCounts = records.reduce((counts, record) => {
  counts[record["数据状态"]] = (counts[record["数据状态"]] ?? 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({
  output: outputPath,
  records: records.length,
  statusCounts,
  reviewGroups: buildReviewCollections(nextState).reviewGroups.length,
}, null, 2));
