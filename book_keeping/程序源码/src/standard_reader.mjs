import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import {
  CURRENCIES,
  DATA_STATUSES,
  DIRECTIONS,
  LEGACY_STANDARD_HEADERS,
  STANDARD_HEADERS,
  SUPPORTED_TEMPLATE_VERSIONS,
  TEMPLATE_VERSION,
  TRANSACTION_TYPES,
} from "./constants.mjs";
import { directionFromSignedAmount, markDuplicates, parseLegacyDate } from "./core.mjs";

function isBlankRow(row) {
  return row.every((value) => value === null || value === "");
}

function headerIndexMap(headerRow) {
  return new Map(headerRow.map((header, index) => [String(header ?? "").trim(), index]));
}

function readTemplateVersion(workbook) {
  const sheet = workbook.worksheets.getItem("填写说明");
  const values = sheet.getRange("A1:B10").values;
  const row = values.find((item) => item?.[0] === "模板版本");
  return String(row?.[1] ?? "");
}

function readReconciliationBaseline(workbook) {
  try {
    const sheet = workbook.worksheets.getItem("对账基准");
    const values = sheet.getUsedRange()?.values ?? [];
    if (values.length < 2) return [];
    const indexes = headerIndexMap(values[0]);
    return values.slice(1).filter((row) => !isBlankRow(row)).map((row) => ({
      sourceSheet: row[indexes.get("来源工作表")],
      scope: row[indexes.get("对账范围")],
      sourceValue: row[indexes.get("旧表值")],
      calculatedValue: row[indexes.get("标准化计算值")],
      difference: row[indexes.get("差异")],
      status: row[indexes.get("结果")],
      note: row[indexes.get("说明")],
    }));
  } catch {
    return [];
  }
}

function normalizeVersion2Row(row, indexes) {
  const record = Object.fromEntries(
    STANDARD_HEADERS.map((header) => [header, row[indexes.get(header)] ?? null]),
  );
  const signed = Number(record["金额"]);
  record["方向"] = directionFromSignedAmount(signed);
  record["金额"] = Number.isFinite(signed) ? Math.abs(signed) : Number.NaN;

  // 新模板允许只输入正负金额。普通收支若没有手选类型，就由符号自动补全；
  // 内部转账、换汇等特殊类型仍应明确选择，避免把资金移动算成收入支出。
  if (!record["交易类型"] && record["方向"]) {
    record["交易类型"] = record["方向"] === "流入" ? "收入" : "支出";
  }
  return record;
}

function normalizeVersion1Row(row, indexes) {
  const legacy = Object.fromEntries(
    LEGACY_STANDARD_HEADERS.map((header) => [header, row[indexes.get(header)] ?? null]),
  );
  return {
    ...legacy,
    "候选日期范围": "",
    "金额": Math.abs(Number(legacy["金额"])),
  };
}

export async function readStandardWorkbook(inputPath) {
  const input = await FileBlob.load(inputPath);
  const workbook = await SpreadsheetFile.importXlsx(input);
  const version = readTemplateVersion(workbook);
  if (!SUPPORTED_TEMPLATE_VERSIONS.includes(version)) {
    throw new Error(`模板版本不兼容：支持 ${SUPPORTED_TEMPLATE_VERSIONS.join("、")}，实际为 ${version || "空"}`);
  }

  const sheet = workbook.worksheets.getItem("标准流水");
  const values = sheet.getUsedRange()?.values ?? [];
  if (values.length === 0) throw new Error("标准流水工作表为空");

  const indexes = headerIndexMap(values[0]);
  const expectedHeaders = version === "1.0" ? LEGACY_STANDARD_HEADERS : STANDARD_HEADERS;
  const missingHeaders = expectedHeaders.filter((header) => !indexes.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`标准流水缺少必需字段：${missingHeaders.join("、")}`);
  }

  const records = [];
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    if (isBlankRow(row)) continue;

    const record = version === "1.0"
      ? normalizeVersion1Row(row, indexes)
      : normalizeVersion2Row(row, indexes);
    if (!record["记录ID"]) record["记录ID"] = `MANUAL-R${rowIndex + 1}`;
    if (!record["交易组ID"]) record["交易组ID"] = record["记录ID"];

    const dateInfo = parseLegacyDate(record["日期"], null);
    record["日期"] = dateInfo.date;
    record["数据状态"] = record["数据状态"] || "有效";

    const reasons = [];
    if (!dateInfo.date) reasons.push(record["候选日期范围"] ? "候选日期范围尚未确认" : dateInfo.reason);
    if (!record["人员"]) reasons.push("缺少人员");
    if (!record["账户"]) reasons.push("缺少账户");
    if (!Number.isFinite(record["金额"]) || record["金额"] <= 0) reasons.push("金额不能为 0，且必须是数字");
    if (!TRANSACTION_TYPES.includes(record["交易类型"])) reasons.push("交易类型无效");
    if (!DIRECTIONS.includes(record["方向"])) reasons.push("金额必须使用正负号表达流入或流出");
    if (record["交易类型"] === "收入" && record["方向"] === "流出") reasons.push("收入不能填写负数金额");
    if (record["交易类型"] === "支出" && record["方向"] === "流入") reasons.push("支出不能填写正数金额");
    if (!CURRENCIES.includes(record["币种"])) reasons.push("币种无效");
    if (!DATA_STATUSES.includes(record["数据状态"])) reasons.push("数据状态无效");

    if (reasons.length > 0) {
      record["数据状态"] = "待确认";
      record["异常原因"] = [...new Set([record["异常原因"], ...reasons].filter(Boolean))].join("；");
    }
    records.push(record);
  }

  markDuplicates(records);
  return {
    records,
    reconciliationBaseline: readReconciliationBaseline(workbook),
    workbook,
    version: version || TEMPLATE_VERSION,
  };
}
