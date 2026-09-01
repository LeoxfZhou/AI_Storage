import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import { COLORS, CURRENCIES } from "./constants.mjs";
import { columnName, signedAmount } from "./core.mjs";
import {
  isRecordIncludedInReport,
  reportingDateForRecord,
  reviewPriorityForRecord,
} from "./review.mjs";

const FULL_HEADERS = [
  "记录ID", "交易组ID", "日期", "候选日期范围", "人员", "账户", "金额", "币种",
  "交易类型", "分类", "对方", "备注", "数据状态", "异常原因", "原始日期",
  "原始描述", "来源工作表", "来源单元格", "导入规则",
  "异常优先级", "统计状态",
];

function styleTitle(range) {
  range.format = {
    fill: COLORS.navy,
    font: { bold: true, color: COLORS.white },
    verticalAlignment: "center",
  };
  range.format.rowHeight = 36;
}

function styleHeader(range, fill = COLORS.blue) {
  range.format = {
    fill,
    font: { bold: true, color: COLORS.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: "#AAB7C2" },
  };
  range.format.rowHeight = 25;
}

function unique(values) {
  return [...new Set(values)];
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function sourceRanges(recordCount) {
  const endRow = Math.max(recordCount + 1, 2);
  const range = (column) => `'完整数据'!$${column}$2:$${column}$${endRow}`;
  return {
    date: range("C"),
    person: range("E"),
    amount: range("G"),
    currency: range("H"),
    type: range("I"),
    // U 列是专门为报表计算准备的“统计状态”。原始数据状态仍保留在 M 列，
    // 这样黄色低优先级可以计入公式，同时不会伪装成已经人工确认的有效记录。
    status: range("U"),
  };
}

function addCompleteDataSheet(workbook, records) {
  const sheet = workbook.worksheets.getItem("完整数据");
  sheet.showGridLines = false;
  const endColumn = columnName(FULL_HEADERS.length);
  const rows = records.map((record) => FULL_HEADERS.map((header) => {
    if (header === "日期") {
      const reportDate = reportingDateForRecord(record);
      // 对可计入但无法确定日期的记录明确写“无日期”，而不是依赖空白单元格。
      // 不同表格引擎对 SUMIFS 空白条件的解释不完全一致，显式标签能让公式稳定。
      return reportDate || (isRecordIncludedInReport(record) ? "无日期" : null);
    }
    if (header === "金额") return signedAmount(record);
    if (header === "异常优先级") return reviewPriorityForRecord(record) || "—";
    if (header === "统计状态") return isRecordIncludedInReport(record) ? "计入" : "不计入";
    return record[header] ?? null;
  }));
  const endRow = Math.max(rows.length + 1, 2);

  sheet.getRange(`A1:${endColumn}1`).values = [FULL_HEADERS];
  styleHeader(sheet.getRange(`A1:${endColumn}1`), COLORS.navy);
  if (rows.length > 0) {
    sheet.getRange(`A2:${endColumn}${rows.length + 1}`).values = rows;
  } else {
    sheet.getRange(`A2:${endColumn}2`).values = [FULL_HEADERS.map(() => null)];
  }
  const table = sheet.tables.add(`A1:${endColumn}${endRow}`, true, "CompleteTransactionsTable");
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(3);

  sheet.getRange(`C2:C${endRow}`).format.numberFormat = "yyyy-mm-dd";
  sheet.getRange(`G2:G${endRow}`).format.numberFormat = "+#,##0.00;-#,##0.00;0.00";
  sheet.getRange(`A2:${endColumn}${endRow}`).conditionalFormats.addCustom('=$M2="待确认"', {
    fill: COLORS.paleAmber,
    font: { color: "#7F6000" },
  });
  sheet.getRange(`A2:${endColumn}${endRow}`).conditionalFormats.addCustom('=$T2="高"', {
    fill: COLORS.paleRed,
    font: { color: COLORS.red },
  });
  sheet.getRange(`A2:${endColumn}${endRow}`).conditionalFormats.addCustom('=$T2="低"', {
    fill: COLORS.paleAmber,
    font: { color: "#7F6000" },
  });
  sheet.getRange(`A2:${endColumn}${endRow}`).conditionalFormats.addCustom('=$M2="忽略"', {
    fill: COLORS.paleGray,
    font: { color: COLORS.gray },
  });

  const widths = [16, 18, 12, 24, 10, 16, 14, 10, 14, 14, 18, 34, 12, 36, 16, 36, 16, 16, 28, 12, 12];
  widths.forEach((width, index) => {
    sheet.getRange(`${columnName(index + 1)}:${columnName(index + 1)}`).format.columnWidth = width;
  });
  sheet.getRange(`L2:S${endRow}`).format.wrapText = true;
  return sheet;
}

function sumFormula(ranges, periodCriteria, currency, type) {
  const base = `${ranges.amount},${periodCriteria},${ranges.currency},"${currency}",${ranges.type},"${type}",${ranges.status},"计入"`;
  return type === "支出" ? `=-SUMIFS(${base})` : `=SUMIFS(${base})`;
}

function countFormula(ranges, periodCriteria, currency) {
  // “有效记录数”应与本页的收支口径一致。期初余额、换汇和内部转账虽然可能是
  // 有效技术记录，但不属于收入或支出；若直接 COUNTIFS 全部有效记录，数量会与
  // 页面上的收入/支出金额对不上，给阅读者造成误解。
  const criteria = `${periodCriteria},${ranges.currency},"${currency}",${ranges.status},"计入",${ranges.type}`;
  return `=COUNTIFS(${criteria},"收入")+COUNTIFS(${criteria},"支出")`;
}

function writeSummaryBlock(sheet, startRow, labelDate, labelFormat, periodCriteriaFactory, ranges, options) {
  const { labelFill, labelFontSize, currencies, periodRecords } = options;
  sheet.getRange(`A${startRow}:J${startRow}`).merge();
  sheet.getRange(`A${startRow}`).values = [[labelDate]];
  sheet.getRange(`A${startRow}:J${startRow}`).format = {
    fill: labelFill,
    font: { bold: true, color: COLORS.navy, size: labelFontSize },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  if (labelFormat) sheet.getRange(`A${startRow}`).format.numberFormat = labelFormat;
  sheet.getRange(`A${startRow}:J${startRow}`).format.rowHeight = 27;

  const periodCriteria = periodCriteriaFactory(startRow);
  const people = unique(periodRecords.map((record) => record["人员"]).filter(Boolean))
    .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"));
  let row = startRow + 1;

  // 每个日期、月份和年份都先展示人员汇总，再展示总体汇总。这样读者先能看清
  // 每个人的贡献，随后再核对总体金额，顺序与用户阅读习惯一致。
  sheet.getRange(`A${row}:J${row}`).merge();
  sheet.getRange(`A${row}`).values = [["个人收支"]];
  sheet.getRange(`A${row}:J${row}`).format = { fill: "#F4F7F9", font: { bold: true, color: COLORS.navy } };
  row += 1;
  sheet.getRange(`A${row}:E${row}`).values = [["人员", "币种", "收入", "支出", "净收支"]];
  styleHeader(sheet.getRange(`A${row}:E${row}`), COLORS.gray);
  row += 1;
  const firstPersonRow = row;
  for (const person of people) {
    const personRecords = periodRecords.filter((record) => record["人员"] === person);
    for (const currency of currenciesIn(personRecords)) {
      sheet.getRange(`A${row}:B${row}`).values = [[person, currency]];
      const personCriteria = `${periodCriteria},${ranges.person},$A${row}`;
      sheet.getRange(`C${row}`).formulas = [[sumFormula(ranges, personCriteria, currency, "收入")]];
      sheet.getRange(`D${row}`).formulas = [[sumFormula(ranges, personCriteria, currency, "支出")]];
      sheet.getRange(`E${row}`).formulas = [[`=C${row}-D${row}`]];
      row += 1;
    }
  }
  if (row > firstPersonRow) sheet.getRange(`C${firstPersonRow}:E${row - 1}`).format.numberFormat = "#,##0.00";

  row += 1;
  sheet.getRange(`A${row}:J${row}`).merge();
  sheet.getRange(`A${row}`).values = [["总体收支"]];
  sheet.getRange(`A${row}:J${row}`).format = { fill: "#EEF4F8", font: { bold: true, color: COLORS.navy } };
  const headers = ["收入", "支出", "净收支", "有效记录数"];

  for (const [currencyIndex, currency] of currencies.entries()) {
    const firstIndex = currencyIndex === 0 ? 1 : 7;
    const firstColumn = columnName(firstIndex);
    const lastColumn = columnName(firstIndex + 3);
    const fill = currency === "USD" ? COLORS.paleGreen : COLORS.paleBlue;
    const color = currency === "USD" ? COLORS.green : COLORS.navy;
    sheet.getRange(`${firstColumn}${row + 1}:${lastColumn}${row + 1}`).merge();
    sheet.getRange(`${firstColumn}${row + 1}`).values = [[currency]];
    sheet.getRange(`${firstColumn}${row + 1}:${lastColumn}${row + 1}`).format = { fill, font: { bold: true, color } };
    sheet.getRange(`${firstColumn}${row + 2}:${lastColumn}${row + 2}`).values = [headers];
    styleHeader(sheet.getRange(`${firstColumn}${row + 2}:${lastColumn}${row + 2}`), currency === "USD" ? COLORS.green : COLORS.blue);

    const incomeColumn = columnName(firstIndex);
    const expenseColumn = columnName(firstIndex + 1);
    const netColumn = columnName(firstIndex + 2);
    const countColumn = columnName(firstIndex + 3);
    const valueRow = row + 3;
    sheet.getRange(`${incomeColumn}${valueRow}`).formulas = [[sumFormula(ranges, periodCriteria, currency, "收入")]];
    sheet.getRange(`${expenseColumn}${valueRow}`).formulas = [[sumFormula(ranges, periodCriteria, currency, "支出")]];
    sheet.getRange(`${netColumn}${valueRow}`).formulas = [[`=${incomeColumn}${valueRow}-${expenseColumn}${valueRow}`]];
    sheet.getRange(`${countColumn}${valueRow}`).formulas = [[countFormula(ranges, periodCriteria, currency)]];
    sheet.getRange(`${incomeColumn}${valueRow}:${netColumn}${valueRow}`).format.numberFormat = "#,##0.00";
    sheet.getRange(`${incomeColumn}${valueRow}:${countColumn}${valueRow}`).format.borders = { preset: "outside", style: "thin", color: "#CCD6DD" };
    sheet.getRange(`${netColumn}${valueRow}`).conditionalFormats.add("cellIs", {
      operator: "lessThan", formula: 0, format: { fill: COLORS.paleRed, font: { color: COLORS.red } },
    });
  }
  return row + 5;
}

function currenciesIn(records) {
  return CURRENCIES.filter((currency) => records.some((record) => record["币种"] === currency));
}

function addPeriodSummarySheet(workbook, records, ranges, options) {
  const { sheetName, title, periods, labelFormat, labelFill, labelFontSize, criteriaForPeriod, recordsForPeriod } = options;
  const sheet = workbook.worksheets.getItem(sheetName);
  sheet.showGridLines = false;
  sheet.getRange("A1:J1").merge();
  sheet.getRange("A1").values = [[title]];
  styleTitle(sheet.getRange("A1:J1"));
  sheet.getRange("A2:J2").merge();
  sheet.getRange("A2").values = [["有效记录与黄色低优先级记录会计入；红色高优先级和忽略记录不计入。无日期记录在末尾单列，没有 USD 收支的期间不显示 USD。"]];
  sheet.getRange("A2:J2").format = { fill: "#EEF4F8", font: { color: COLORS.gray } };
  let row = 4;
  for (const period of periods) {
    const periodRecords = recordsForPeriod(period);
    const currencies = currenciesIn(periodRecords);
    if (currencies.length === 0) continue;
    row = writeSummaryBlock(
      sheet,
      row,
      period instanceof Date ? period : new Date(Date.UTC(period, 0, 1)),
      labelFormat,
      (labelRow) => criteriaForPeriod(period, labelRow),
      ranges,
      { labelFill, labelFontSize, currencies, periodRecords },
    );
  }
  const undatedRecords = records.filter((record) => !(record["日期"] instanceof Date));
  const undatedCurrencies = currenciesIn(undatedRecords);
  if (undatedCurrencies.length > 0) {
    row = writeSummaryBlock(
      sheet,
      row,
      "无日期记录",
      null,
      () => `${ranges.date},"无日期"`,
      ranges,
      {
        labelFill: COLORS.paleAmber,
        labelFontSize,
        currencies: undatedCurrencies,
        periodRecords: undatedRecords,
      },
    );
  }
  if (row === 4) {
    sheet.getRange("A4:J4").merge();
    sheet.getRange("A4").values = [["暂无可计入的收入或支出记录"]];
    sheet.getRange("A4:J4").format = { fill: COLORS.paleGray, font: { color: COLORS.gray }, horizontalAlignment: "left" };
  }

  ["A", "B", "C", "D", "E", "G", "H", "I", "J"].forEach((column) => {
    sheet.getRange(`${column}:${column}`).format.columnWidth = column === "D" || column === "J" ? 15 : 17;
  });
  sheet.getRange("F:F").format.columnWidth = 3;
  sheet.freezePanes.freezeRows(2);
  return sheet;
}

function dailyPeriodCriteria(ranges, dateRow) {
  return `${ranges.date},$A$${dateRow}`;
}

function monthPeriodCriteria(ranges, monthStart) {
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth() + 1;
  return `${ranges.date},">="&DATE(${year},${month},1),${ranges.date},"<"&DATE(${year},${month + 1},1)`;
}

function yearPeriodCriteria(ranges, year) {
  return `${ranges.date},">="&DATE(${year},1,1),${ranges.date},"<"&DATE(${year + 1},1,1)`;
}

function writeIncomeExpenseNetRows(sheet, row, labelPrefix, periodCriteria, currency, ranges) {
  const labels = ["收入", "支出", "净收支"];
  sheet.getRange(`B${row}:B${row + 2}`).values = labels.map((label) => [`${currency} ${labelPrefix}${label}`]);
  sheet.getRange(`C${row}`).formulas = [[sumFormula(ranges, periodCriteria, currency, "收入")]];
  sheet.getRange(`C${row + 1}`).formulas = [[sumFormula(ranges, periodCriteria, currency, "支出")]];
  sheet.getRange(`C${row + 2}`).formulas = [[`=C${row}-C${row + 1}`]];
  sheet.getRange(`B${row}:C${row + 2}`).format = { fill: "#F4F7F9", font: { bold: true, color: COLORS.navy } };
  sheet.getRange(`C${row}:C${row + 2}`).format.numberFormat = "#,##0.00";
  return row + 3;
}

function addReadableLedgerSheet(workbook, records, ranges) {
  const sheet = workbook.worksheets.getItem("简洁流水");
  sheet.showGridLines = false;
  sheet.getRange("A1:J1").merge();
  sheet.getRange("A1").values = [["简洁流水"]];
  styleTitle(sheet.getRange("A1:J1"));
  sheet.getRange("A2:J2").merge();
  sheet.getRange("A2").values = [["金额正数为收入、负数为支出；F:H为空白分隔区，右侧保留原始信息供需要时查看。"]];
  sheet.getRange("A2:J2").format = { fill: "#EEF4F8", font: { color: COLORS.gray } };

  const valid = records
    .filter(isRecordIncludedInReport)
    .map((record) => ({ ...record, "日期": reportingDateForRecord(record) }))
    .sort((left, right) => {
      const leftTime = left["日期"] instanceof Date ? left["日期"].getTime() : Number.POSITIVE_INFINITY;
      const rightTime = right["日期"] instanceof Date ? right["日期"].getTime() : Number.POSITIVE_INFINITY;
      return leftTime - rightTime || String(left["人员"]).localeCompare(String(right["人员"]), "zh-CN");
    });
  const datedRecords = valid.filter((record) => record["日期"] instanceof Date);
  const undatedRecords = valid.filter((record) => !(record["日期"] instanceof Date));
  const dateGroups = new Map();
  for (const record of datedRecords) {
    const key = dateKey(record["日期"]);
    if (!dateGroups.has(key)) dateGroups.set(key, []);
    dateGroups.get(key).push(record);
  }

  let row = 4;
  let currentMonth = null;
  let currentYear = null;

  const writePersonPeriodSummary = ({
    labelValue,
    labelFormat,
    periodRecords,
    criteria,
    fill,
    color,
    fontSize,
    totalPrefix,
  }) => {
    const incomeExpenseRecords = periodRecords.filter((record) => ["收入", "支出"].includes(record["交易类型"]));
    const people = unique(incomeExpenseRecords.map((record) => record["人员"]).filter(Boolean))
      .sort((left, right) => String(left).localeCompare(String(right), "zh-CN"));
    const currencies = currenciesIn(incomeExpenseRecords);

    row += 1;
    sheet.getRange(`A${row}:J${row}`).merge();
    sheet.getRange(`A${row}`).values = [[labelValue]];
    if (labelFormat) sheet.getRange(`A${row}`).format.numberFormat = labelFormat;
    sheet.getRange(`A${row}:J${row}`).format = {
      fill,
      font: { bold: true, color, size: fontSize },
      horizontalAlignment: "left",
      verticalAlignment: "center",
    };
    sheet.getRange(`A${row}:J${row}`).format.rowHeight = fontSize >= 16 ? 34 : 30;

    if (people.length > 0) {
      row += 1;
      sheet.getRange(`A${row}:E${row}`).values = [["人员", "币种", "收入", "支出", "净收支"]];
      styleHeader(sheet.getRange(`A${row}:E${row}`), color);
      row += 1;
      const firstPersonRow = row;
      for (const person of people) {
        const personRecords = incomeExpenseRecords.filter((record) => record["人员"] === person);
        for (const currency of currenciesIn(personRecords)) {
          sheet.getRange(`A${row}:B${row}`).values = [[person, currency]];
          const personCriteria = `${criteria},${ranges.person},$A${row}`;
          sheet.getRange(`C${row}`).formulas = [[sumFormula(ranges, personCriteria, currency, "收入")]];
          sheet.getRange(`D${row}`).formulas = [[sumFormula(ranges, personCriteria, currency, "支出")]];
          sheet.getRange(`E${row}`).formulas = [[`=C${row}-D${row}`]];
          row += 1;
        }
      }
      sheet.getRange(`C${firstPersonRow}:E${row - 1}`).format.numberFormat = "#,##0.00";
    }

    if (currencies.length > 0) {
      row += 1;
      for (const currency of currencies) row = writeIncomeExpenseNetRows(sheet, row, totalPrefix, criteria, currency, ranges);
    }
    row += 1;
  };

  const writeMonthEnding = (monthStart) => {
    if (!monthStart) return;
    const key = monthKey(monthStart);
    writePersonPeriodSummary({
      labelValue: monthStart,
      labelFormat: 'yyyy-mm" 月个人汇总"',
      periodRecords: datedRecords.filter((record) => monthKey(record["日期"]) === key),
      criteria: monthPeriodCriteria(ranges, monthStart),
      fill: COLORS.paleGreen,
      color: COLORS.green,
      fontSize: 14,
      totalPrefix: "月总",
    });
  };

  const writeYearEnding = (year) => {
    if (!year) return;
    writePersonPeriodSummary({
      labelValue: `${year} 年度个人与总计`,
      labelFormat: null,
      periodRecords: datedRecords.filter((record) => record["日期"].getUTCFullYear() === year),
      criteria: yearPeriodCriteria(ranges, year),
      fill: COLORS.paleAmber,
      color: "#7F6000",
      fontSize: 17,
      totalPrefix: "年度",
    });
  };

  for (const [key, dayRecords] of dateGroups) {
    const day = new Date(`${key}T00:00:00.000Z`);
    const month = monthKey(day);
    const year = day.getUTCFullYear();
    if (currentMonth && month !== currentMonth) {
      const [monthYear, monthNumber] = currentMonth.split("-").map(Number);
      writeMonthEnding(new Date(Date.UTC(monthYear, monthNumber - 1, 1)));
    }
    if (currentYear && year !== currentYear) writeYearEnding(currentYear);
    currentMonth = month;
    currentYear = year;

    row += 1;
    const dateHeaderRow = row;
    sheet.getRange(`A${row}:J${row}`).merge();
    sheet.getRange(`A${row}`).values = [[day]];
    sheet.getRange(`A${row}`).format.numberFormat = 'yyyy-mm-dd" 记账"';
    sheet.getRange(`A${row}:J${row}`).format = {
      fill: COLORS.paleBlue,
      font: { bold: true, color: COLORS.navy, size: 11 },
      horizontalAlignment: "left",
    };
    row += 1;
    sheet.getRange(`A${row}:J${row}`).values = [["日期", "人员", "金额", "交易类型", "分类", null, null, null, "备注", "原始描述"]];
    styleHeader(sheet.getRange(`A${row}:E${row}`), COLORS.blue);
    styleHeader(sheet.getRange(`I${row}:J${row}`), COLORS.gray);
    row += 1;

    for (const currency of CURRENCIES) {
      const currencyRecords = dayRecords.filter((record) => record["币种"] === currency);
      if (currencyRecords.length === 0) continue;
      sheet.getRange(`A${row}:J${row}`).merge();
      sheet.getRange(`A${row}`).values = [[`${currency} 明细`]];
      sheet.getRange(`A${row}:J${row}`).format = { fill: "#F5F8FA", font: { bold: true, color: COLORS.gray } };
      row += 1;
      const transactionRows = currencyRecords.map((record) => [
        record["日期"], record["人员"], signedAmount(record), record["交易类型"], record["分类"],
        null, null, null, record["备注"], record["原始描述"],
      ]);
      sheet.getRange(`A${row}:J${row + transactionRows.length - 1}`).values = transactionRows;
      sheet.getRange(`A${row}:A${row + transactionRows.length - 1}`).format.numberFormat = "yyyy-mm-dd";
      sheet.getRange(`C${row}:C${row + transactionRows.length - 1}`).format.numberFormat = "+#,##0.00;-#,##0.00;0.00";
      sheet.getRange(`I${row}:J${row + transactionRows.length - 1}`).format.wrapText = true;
      row += transactionRows.length;
      row = writeIncomeExpenseNetRows(sheet, row, "日期总", dailyPeriodCriteria(ranges, dateHeaderRow), currency, ranges);
    }
  }

  if (currentMonth) {
    const [monthYear, monthNumber] = currentMonth.split("-").map(Number);
    writeMonthEnding(new Date(Date.UTC(monthYear, monthNumber - 1, 1)));
  }
  if (currentYear) writeYearEnding(currentYear);

  if (undatedRecords.length > 0) {
    row += 1;
    sheet.getRange(`A${row}:J${row}`).merge();
    sheet.getRange(`A${row}`).values = [["无日期记录"]];
    sheet.getRange(`A${row}:J${row}`).format = {
      fill: COLORS.paleAmber,
      font: { bold: true, color: "#7F6000", size: 15 },
      horizontalAlignment: "left",
    };
    sheet.getRange(`A${row}:J${row}`).format.rowHeight = 32;
    row += 1;
    sheet.getRange(`A${row}:J${row}`).values = [["日期", "人员", "金额", "交易类型", "分类", null, null, null, "备注", "原始描述"]];
    styleHeader(sheet.getRange(`A${row}:E${row}`), "#B8860B");
    styleHeader(sheet.getRange(`I${row}:J${row}`), COLORS.gray);
    row += 1;

    const undatedCriteria = `${ranges.date},"无日期"`;
    for (const currency of currenciesIn(undatedRecords)) {
      const currencyRecords = undatedRecords.filter((record) => record["币种"] === currency);
      sheet.getRange(`A${row}:J${row}`).merge();
      sheet.getRange(`A${row}`).values = [[`${currency} 无日期明细`]];
      sheet.getRange(`A${row}:J${row}`).format = { fill: "#FFF7DF", font: { bold: true, color: "#7F6000" } };
      row += 1;
      const transactionRows = currencyRecords.map((record) => [
        "无日期", record["人员"], signedAmount(record), record["交易类型"], record["分类"],
        null, null, null, record["备注"], record["原始描述"],
      ]);
      sheet.getRange(`A${row}:J${row + transactionRows.length - 1}`).values = transactionRows;
      sheet.getRange(`C${row}:C${row + transactionRows.length - 1}`).format.numberFormat = "+#,##0.00;-#,##0.00;0.00";
      sheet.getRange(`I${row}:J${row + transactionRows.length - 1}`).format.wrapText = true;
      row += transactionRows.length;
      row = writeIncomeExpenseNetRows(sheet, row, "无日期总", undatedCriteria, currency, ranges);
    }

    writePersonPeriodSummary({
      labelValue: "无日期个人与总计",
      labelFormat: null,
      periodRecords: undatedRecords,
      criteria: undatedCriteria,
      fill: COLORS.paleAmber,
      color: "#7F6000",
      fontSize: 15,
      totalPrefix: "无日期",
    });
  }

  const widths = [14, 12, 16, 15, 16, 3, 3, 3, 34, 42];
  widths.forEach((width, index) => {
    sheet.getRange(`${columnName(index + 1)}:${columnName(index + 1)}`).format.columnWidth = width;
  });
  sheet.freezePanes.freezeRows(2);
  return sheet;
}

export function buildReportWorkbook({ records }) {
  const workbook = Workbook.create();
  const ranges = sourceRanges(records.length);
  const summaryRecords = records
    .filter((record) => isRecordIncludedInReport(record) && ["收入", "支出"].includes(record["交易类型"]))
    .map((record) => ({ ...record, "日期": reportingDateForRecord(record) }));
  const datedSummaryRecords = summaryRecords.filter((record) => record["日期"] instanceof Date);
  const dates = unique(datedSummaryRecords.map((record) => dateKey(record["日期"])))
    .sort()
    .map((value) => new Date(`${value}T00:00:00.000Z`));
  const months = unique(datedSummaryRecords.map((record) => monthKey(record["日期"])))
    .sort()
    .map((value) => {
      const [year, month] = value.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, 1));
    });
  const years = unique(datedSummaryRecords.map((record) => record["日期"].getUTCFullYear())).sort();

  // 先创建全部工作表再写公式，保证跨表引用始终指向已存在的工作表。
  // 日、月、年拆开后，读者不用在一张很长的汇总页中反复滚动查找。
  workbook.worksheets.add("简洁流水");
  workbook.worksheets.add("日汇总");
  workbook.worksheets.add("月汇总");
  workbook.worksheets.add("年汇总");
  workbook.worksheets.add("完整数据");
  addCompleteDataSheet(workbook, records);
  addReadableLedgerSheet(workbook, records, ranges);
  addPeriodSummarySheet(workbook, summaryRecords, ranges, {
    sheetName: "日汇总",
    title: "每日收支汇总",
    periods: dates,
    labelFormat: "yyyy-mm-dd",
    labelFill: COLORS.paleBlue,
    labelFontSize: 12,
    criteriaForPeriod: (_period, labelRow) => `${ranges.date},$A$${labelRow}`,
    recordsForPeriod: (period) => datedSummaryRecords.filter((record) => dateKey(record["日期"]) === dateKey(period)),
  });
  addPeriodSummarySheet(workbook, summaryRecords, ranges, {
    sheetName: "月汇总",
    title: "月度收支汇总",
    periods: months,
    labelFormat: 'yyyy-mm" 月总结"',
    labelFill: COLORS.paleGreen,
    labelFontSize: 15,
    criteriaForPeriod: (_period, labelRow) => `${ranges.date},">="&$A$${labelRow},${ranges.date},"<"&DATE(YEAR($A$${labelRow}),MONTH($A$${labelRow})+1,1)`,
    recordsForPeriod: (period) => datedSummaryRecords.filter((record) => monthKey(record["日期"]) === monthKey(period)),
  });
  addPeriodSummarySheet(workbook, summaryRecords, ranges, {
    sheetName: "年汇总",
    title: "年度收支汇总",
    periods: years,
    labelFormat: 'yyyy" 年总结"',
    labelFill: COLORS.paleAmber,
    labelFontSize: 17,
    criteriaForPeriod: (_period, labelRow) => `${ranges.date},">="&$A$${labelRow},${ranges.date},"<"&DATE(YEAR($A$${labelRow})+1,1,1)`,
    recordsForPeriod: (period) => datedSummaryRecords.filter((record) => record["日期"].getUTCFullYear() === period),
  });
  return workbook;
}

export async function saveReportWorkbook(workbook, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
}
