import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import {
  COLORS,
  CURRENCIES,
  DATA_STATUSES,
  DEFAULT_ACCOUNTS,
  DEFAULT_CATEGORIES,
  DEFAULT_PEOPLE,
  STANDARD_HEADERS,
  TEMPLATE_VERSION,
  TRANSACTION_TYPES,
} from "./constants.mjs";
import { columnName, signedAmount } from "./core.mjs";
import { reviewPriorityForRecord } from "./review.mjs";

function styleHeader(range, fill = COLORS.navy) {
  range.format = {
    fill,
    font: { bold: true, color: COLORS.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: "#B8C2CC" },
  };
  range.format.rowHeight = 28;
}

function styleTitle(range) {
  range.format = {
    fill: COLORS.navy,
    font: { bold: true, color: COLORS.white },
    verticalAlignment: "center",
  };
  range.format.rowHeight = 34;
}

function writeSimpleTable(sheet, startRow, headers, rows, tableName) {
  const endRow = startRow + Math.max(rows.length, 1);
  const endColumn = columnName(headers.length);
  sheet.getRange(`A${startRow}:${endColumn}${startRow}`).values = [headers];
  styleHeader(sheet.getRange(`A${startRow}:${endColumn}${startRow}`), COLORS.blue);

  if (rows.length > 0) {
    sheet.getRange(`A${startRow + 1}:${endColumn}${startRow + rows.length}`).values = rows;
  } else {
    sheet.getRange(`A${startRow + 1}:${endColumn}${startRow + 1}`).values = [headers.map(() => null)];
  }

  const table = sheet.tables.add(`A${startRow}:${endColumn}${endRow}`, true, tableName);
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;
  return { endRow, endColumn };
}

function addDictionarySheet(workbook, sheetName, title, values, tableName) {
  const sheet = workbook.worksheets.add(sheetName);
  sheet.showGridLines = false;
  sheet.getRange("A1:B1").merge();
  sheet.getRange("A1").values = [[title]];
  styleTitle(sheet.getRange("A1:B1"));
  writeSimpleTable(sheet, 3, ["可选值", "说明"], values.map((value) => [value, "可按需要新增"]), tableName);
  sheet.getRange(`A3:B${values.length + 3}`).format.autofitColumns();
  sheet.getRange("A:A").format.columnWidth = 18;
  sheet.getRange("B:B").format.columnWidth = 24;
  sheet.freezePanes.freezeRows(3);
  return sheet;
}

function addInstructionSheet(workbook, sourceFile, recordCount) {
  const sheet = workbook.worksheets.add("填写说明");
  sheet.showGridLines = false;
  sheet.getRange("A1:D1").merge();
  sheet.getRange("A1").values = [["标准记账输入数据"]];
  styleTitle(sheet.getRange("A1:D1"));

  const metaRows = [
    ["模板版本", TEMPLATE_VERSION],
    ["来源文件", sourceFile || "空白模板"],
    ["标准流水记录数", recordCount],
    ["生成说明", "只有数据状态为“有效”的记录才进入统计报表。"],
  ];
  sheet.getRange("A3:B6").values = metaRows;
  sheet.getRange("A3:A6").format = { font: { bold: true, color: COLORS.navy }, fill: COLORS.paleBlue };
  sheet.getRange("A3:B6").format.borders = { preset: "outside", style: "thin", color: "#B8C2CC" };

  const guidance = [
    ["主题", "填写规则", "为什么这样做"],
    ["一行一笔", "每个人、每个账户的一次资金变化占一行。", "多人或换汇交易如果挤在一行，会造成漏算或重复统计。"],
    ["金额", "收入填写正数，例如 +500；支出填写负数，例如 -200。", "金额正负号直接表达资金方向，不再单独维护方向列。"],
    ["日期", "使用完整日期，例如 2026-08-22；无法确定时可留空。", "无日期记录会在最终报表末尾单列，不会被强行归入某日、某月或某年。"],
    ["内部转账", "转出与转入使用同一个交易组ID，交易类型选内部转账。", "内部资金移动影响余额，但不属于收入或支出。"],
    ["换汇", "人民币流出与美元流入各占一行，并使用同一个交易组ID。", "不同币种不能直接相加，也不能把购汇当作消费。"],
    ["待确认", "无法确定日期、归属或是否重复时保留原文并设为待确认。", "程序不会为了凑数强行猜测。"],
  ];
  sheet.getRange(`A9:C${8 + guidance.length}`).values = guidance;
  styleHeader(sheet.getRange("A9:C9"), COLORS.blue);
  sheet.getRange(`A10:C${8 + guidance.length}`).format.wrapText = true;
  sheet.getRange("A:A").format.columnWidth = 18;
  sheet.getRange("B:B").format.columnWidth = 42;
  sheet.getRange("C:C").format.columnWidth = 48;
  sheet.freezePanes.freezeRows(1);
  return sheet;
}

function addStandardLedgerSheet(workbook, records, reserveRows = 200) {
  const sheet = workbook.worksheets.add("标准流水");
  sheet.showGridLines = false;

  const dataRows = records.map((record) => STANDARD_HEADERS.map((header) => {
    if (header === "金额") return signedAmount(record);
    return record[header] ?? null;
  }));
  const endRow = Math.max(dataRows.length + 1, 2);
  const endColumn = columnName(STANDARD_HEADERS.length);
  sheet.getRange(`A1:${endColumn}1`).values = [STANDARD_HEADERS];
  styleHeader(sheet.getRange(`A1:${endColumn}1`));

  if (dataRows.length > 0) {
    sheet.getRange(`A2:${endColumn}${dataRows.length + 1}`).values = dataRows;
  } else {
    sheet.getRange(`A2:${endColumn}2`).values = [STANDARD_HEADERS.map(() => null)];
  }

  const table = sheet.tables.add(`A1:${endColumn}${endRow}`, true, "StandardTransactionsTable");
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(3);

  const validationEnd = Math.max(endRow + 50, reserveRows + 1);
  sheet.getRange(`E2:E${validationEnd}`).dataValidation = { rule: { type: "list", values: DEFAULT_PEOPLE } };
  sheet.getRange(`F2:F${validationEnd}`).dataValidation = { rule: { type: "list", values: DEFAULT_ACCOUNTS } };
  sheet.getRange(`H2:H${validationEnd}`).dataValidation = { rule: { type: "list", values: CURRENCIES } };
  sheet.getRange(`I2:I${validationEnd}`).dataValidation = { rule: { type: "list", values: TRANSACTION_TYPES } };
  sheet.getRange(`J2:J${validationEnd}`).dataValidation = { rule: { type: "list", values: DEFAULT_CATEGORIES } };
  sheet.getRange(`M2:M${validationEnd}`).dataValidation = { rule: { type: "list", values: DATA_STATUSES } };

  sheet.getRange(`C2:C${validationEnd}`).format.numberFormat = "yyyy-mm-dd";
  sheet.getRange(`G2:G${validationEnd}`).format.numberFormat = "+#,##0.00;-#,##0.00;0.00";
  sheet.getRange(`G2:G${validationEnd}`).format.horizontalAlignment = "right";
  sheet.getRange(`L2:L${validationEnd}`).format.wrapText = true;
  sheet.getRange(`N2:P${validationEnd}`).format.wrapText = true;
  sheet.getRange(`S2:S${validationEnd}`).format.wrapText = true;

  const statusArea = sheet.getRange(`A2:${endColumn}${validationEnd}`);
  statusArea.conditionalFormats.addCustom('=$M2="待确认"', {
    fill: COLORS.paleAmber,
    font: { color: "#7F6000" },
  });
  statusArea.conditionalFormats.addCustom('=$M2="忽略"', {
    fill: COLORS.paleGray,
    font: { color: COLORS.gray },
  });
  sheet.getRange(`A2:A${validationEnd}`).conditionalFormats.addCustom(
    `=AND(A2<>"",COUNTIF($A$2:$A$${validationEnd},A2)>1)`,
    { fill: COLORS.paleRed, font: { color: COLORS.red } },
  );

  const widths = [16, 18, 12, 24, 10, 16, 14, 10, 14, 14, 18, 36, 12, 36, 16, 36, 16, 16, 28];
  widths.forEach((width, index) => {
    sheet.getRange(`${columnName(index + 1)}:${columnName(index + 1)}`).format.columnWidth = width;
  });
  return sheet;
}

function addExceptionSheet(workbook, records) {
  const sheet = workbook.worksheets.add("异常记录");
  sheet.showGridLines = false;
  const headers = ["记录ID", "优先级", "数据状态", "候选日期范围", "来源工作表", "来源单元格", "原始日期", "原始描述", "异常原因", "统计处理", "建议操作"];
  const exceptionRows = records
    .filter((record) => record["数据状态"] !== "有效")
    // Excel 异常清单与网页保持同一阅读顺序：先处理会阻断统计的红色高优先级，
    // 再检查不阻断统计的黄色日期问题。若不排序，用户需要在长表里来回寻找红色行。
    .sort((left, right) => Number(reviewPriorityForRecord(right) === "高") - Number(reviewPriorityForRecord(left) === "高"))
    .map((record) => [
      record["记录ID"],
      reviewPriorityForRecord(record) || "—",
      record["数据状态"],
      record["候选日期范围"],
      record["来源工作表"],
      record["来源单元格"],
      record["原始日期"],
      record["原始描述"],
      record["异常原因"],
      reviewPriorityForRecord(record) === "低"
        ? (record["候选日期范围"] ? "按候选范围起始日暂定计入" : "在无日期区块中计入")
        : "处理前不计入",
      record["数据状态"] === "待确认" ? "修正标准流水并将状态改为有效" : "无需处理，除非确认应纳入统计",
    ]);
  writeSimpleTable(sheet, 1, headers, exceptionRows, "ExceptionRecordsTable");
  sheet.freezePanes.freezeRows(1);
  sheet.getRange("A:K").format.autofitColumns();
  ["D", "G", "H", "I", "J", "K"].forEach((column) => {
    sheet.getRange(`${column}:${column}`).format.columnWidth = column === "H" ? 42 : 30;
  });
  const exceptionArea = sheet.getRange(`A2:K${Math.max(2, exceptionRows.length + 1)}`);
  exceptionArea.format.wrapText = true;
  exceptionArea.conditionalFormats.addCustom('=$B2="高"', {
    fill: COLORS.paleRed,
    font: { color: COLORS.red },
  });
  exceptionArea.conditionalFormats.addCustom('=$B2="低"', {
    fill: COLORS.paleAmber,
    font: { color: "#7F6000" },
  });
  return sheet;
}

function addLogSheet(workbook, logs) {
  const sheet = workbook.worksheets.add("导入日志");
  sheet.showGridLines = false;
  const rows = logs.map((log) => [log.sheet, log.status, log.detail, log.imported]);
  writeSimpleTable(sheet, 1, ["工作表", "处理状态", "处理说明", "生成记录数"], rows, "ImportLogTable");
  sheet.freezePanes.freezeRows(1);
  sheet.getRange("A:D").format.autofitColumns();
  sheet.getRange("C:C").format.columnWidth = 52;
  sheet.getRange(`D2:D${Math.max(2, rows.length + 1)}`).format.numberFormat = "#,##0";
  return sheet;
}

function addReconciliationSheet(workbook, reconciliation) {
  const sheet = workbook.worksheets.add("对账基准");
  sheet.showGridLines = false;
  const headers = ["来源工作表", "对账范围", "旧表值", "标准化计算值", "差异", "结果", "说明"];
  const rows = reconciliation.map((item) => [
    item.sourceSheet,
    item.scope,
    item.sourceValue,
    item.calculatedValue,
    null,
    null,
    item.note,
  ]);
  writeSimpleTable(sheet, 1, headers, rows, "ReconciliationBaselineTable");
  const endRow = Math.max(2, rows.length + 1);
  if (rows.length > 0) {
    sheet.getRange("E2").formulas = [['=IF(OR(C2="",D2=""),"",D2-C2)']];
    sheet.getRange(`E2:E${endRow}`).fillDown();
    sheet.getRange("F2").formulas = [['=IF(OR(C2="",D2=""),"待确认",IF(ABS(E2)<=0.01,"通过","差异"))']];
    sheet.getRange(`F2:F${endRow}`).fillDown();
  }
  sheet.getRange(`C2:E${endRow}`).format.numberFormat = "#,##0.00";
  sheet.getRange(`A2:G${endRow}`).conditionalFormats.addCustom('=$F2="通过"', {
    fill: COLORS.paleGreen,
    font: { color: COLORS.green },
  });
  sheet.getRange(`A2:G${endRow}`).conditionalFormats.addCustom('=$F2="差异"', {
    fill: COLORS.paleRed,
    font: { color: COLORS.red },
  });
  sheet.freezePanes.freezeRows(1);
  sheet.getRange("A:G").format.autofitColumns();
  sheet.getRange("B:B").format.columnWidth = 34;
  sheet.getRange("G:G").format.columnWidth = 48;
  return sheet;
}

export function buildStandardWorkbook({ records = [], logs = [], reconciliation = [], sourceFile = "" }) {
  const workbook = Workbook.create();
  addInstructionSheet(workbook, sourceFile, records.length);
  addStandardLedgerSheet(workbook, records);
  addExceptionSheet(workbook, records);
  addLogSheet(workbook, logs);
  addReconciliationSheet(workbook, reconciliation);
  addDictionarySheet(workbook, "人员字典", "人员字典", DEFAULT_PEOPLE, "PeopleDictionaryTable");
  addDictionarySheet(workbook, "账户字典", "账户字典", DEFAULT_ACCOUNTS, "AccountDictionaryTable");
  addDictionarySheet(workbook, "分类字典", "分类字典", DEFAULT_CATEGORIES, "CategoryDictionaryTable");
  return workbook;
}

export async function saveWorkbook(workbook, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
}
