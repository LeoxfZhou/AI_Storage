#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getArg } from "./src/core.mjs";
import { buildReportWorkbook, saveReportWorkbook } from "./src/report_workbook.mjs";
import { readStandardWorkbook } from "./src/standard_reader.mjs";

const args = process.argv.slice(2);
const projectDir = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.resolve(
  getArg(args, "--input", path.join(projectDir, "outputs", "标准化输入数据.xlsx")),
);
const outputPath = path.resolve(
  getArg(args, "--output", path.join(projectDir, "outputs", "记账分析报告.xlsx")),
);

const { records, reconciliationBaseline, version } = await readStandardWorkbook(inputPath);
const workbook = buildReportWorkbook({ records, reconciliationBaseline, inputPath });
await saveReportWorkbook(workbook, outputPath);

const statusCounts = records.reduce((counts, record) => {
  counts[record["数据状态"]] = (counts[record["数据状态"]] ?? 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({
  input: inputPath,
  output: outputPath,
  templateVersion: version,
  records: records.length,
  statusCounts,
  reconciliationChecks: reconciliationBaseline.length,
}, null, 2));
