#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import { getArg, markDuplicates } from "./src/core.mjs";
import {
  buildSheetClassificationLog,
  importFactoryLedger,
  importPersonalLedger,
  importYiwuLedger,
} from "./src/legacy_importers.mjs";
import { buildStandardWorkbook, saveWorkbook } from "./src/standard_workbook.mjs";
import { buildReviewGroups, saveReviewState } from "./src/review.mjs";

const args = process.argv.slice(2);
const mode = args[0];
const projectDir = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`
用法：
  node prepare_data.mjs template [--output 标准输入模板.xlsx]
  node prepare_data.mjs migrate --input 流水.xlsx [--output 标准化输入数据.xlsx]
    [--sheets-json '["厂收支明细","自己明细"]'] [--review-json review-state.json]

说明：
  template  创建可直接填写的空白标准模板。
  migrate   只读旧工作簿，将三张原始流水转换成统一长表。
`);
}

if (!["template", "migrate"].includes(mode)) {
  usage();
  process.exitCode = 1;
} else if (mode === "template") {
  const outputPath = path.resolve(
    getArg(args, "--output", path.join(projectDir, "outputs", "标准输入模板.xlsx")),
  );
  const workbook = buildStandardWorkbook({
    records: [],
    logs: [{ sheet: "空白模板", status: "已创建", detail: "尚未导入历史数据", imported: 0 }],
    reconciliation: [],
    sourceFile: "空白模板",
  });
  await saveWorkbook(workbook, outputPath);
  console.log(JSON.stringify({ mode, output: outputPath, records: 0 }, null, 2));
} else {
  const inputPath = path.resolve(
    getArg(args, "--input", path.join(projectDir, "流水.xlsx")),
  );
  const outputPath = path.resolve(
    getArg(args, "--output", path.join(projectDir, "outputs", "标准化输入数据.xlsx")),
  );
  const reviewJsonArg = getArg(args, "--review-json", null);
  const reviewJsonPath = reviewJsonArg ? path.resolve(reviewJsonArg) : null;
  const importerBySheet = new Map([
    ["厂收支明细", importFactoryLedger],
    ["自己明细", importPersonalLedger],
    ["义乌流水", importYiwuLedger],
  ]);
  let selectedSheets;
  try {
    selectedSheets = JSON.parse(
      getArg(args, "--sheets-json", JSON.stringify([...importerBySheet.keys()])),
    );
  } catch {
    throw new Error("--sheets-json 必须是工作表名称组成的 JSON 数组");
  }
  if (!Array.isArray(selectedSheets) || selectedSheets.length === 0) {
    throw new Error("请至少选择一个原始流水工作表");
  }
  const unsupportedSheets = selectedSheets.filter((sheetName) => !importerBySheet.has(sheetName));
  if (unsupportedSheets.length > 0) {
    throw new Error(`尚未配置这些工作表的导入规则：${unsupportedSheets.join("、")}`);
  }

  const input = await FileBlob.load(inputPath);
  const legacyWorkbook = await SpreadsheetFile.importXlsx(input);

  // 每张原始表使用独立适配器，避免把一张表的特殊规则散落到整个程序里。
  // 以后增加新的历史格式时，只需要新增适配器，不会影响标准模板和报表程序。
  const imports = selectedSheets.map((sheetName) => importerBySheet.get(sheetName)(legacyWorkbook));
  const classificationLogs = await buildSheetClassificationLog(legacyWorkbook);
  const importLogs = imports.map((result) => result.log);
  const importedSheetNames = new Set(importLogs.map((log) => log.sheet));
  const logs = classificationLogs.map((classification) => {
    const actual = importLogs.find((log) => log.sheet === classification.sheet);
    if (actual) return actual;
    if (importerBySheet.has(classification.sheet)) {
      return {
        ...classification,
        status: "未选择",
        detail: "用户本次没有选择该原始流水工作表",
      };
    }
    return classification;
  });
  for (const log of importLogs) {
    if (!logs.some((item) => item.sheet === log.sheet)) logs.push(log);
  }

  const records = markDuplicates(imports.flatMap((result) => result.records));
  const reconciliation = imports.flatMap((result) => result.reconciliation);
  const workbook = buildStandardWorkbook({
    records,
    logs,
    reconciliation,
    sourceFile: inputPath,
  });
  await saveWorkbook(workbook, outputPath);
  if (reviewJsonPath) {
    await fs.mkdir(path.dirname(reviewJsonPath), { recursive: true });
    await saveReviewState(reviewJsonPath, {
      records,
      logs,
      reconciliation,
      sourceFile: inputPath,
      selectedSheets,
    });
  }

  const statusCounts = records.reduce((counts, record) => {
    counts[record["数据状态"]] = (counts[record["数据状态"]] ?? 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify({
    mode,
    input: inputPath,
    output: outputPath,
    importedSheets: [...importedSheetNames],
    records: records.length,
    statusCounts,
    reconciliationChecks: reconciliation.length,
    reviewGroups: buildReviewGroups(records).length,
  }, null, 2));
}
