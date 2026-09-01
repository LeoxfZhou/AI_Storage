import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import { getArg } from "./src/core.mjs";
import { isRecordIncludedInReport, reportingDateForRecord } from "./src/review.mjs";
import { readStandardWorkbook } from "./src/standard_reader.mjs";

const args = process.argv.slice(2);
const standardArg = getArg(args, "--standard", null);
const reportArg = getArg(args, "--report", null);
if (!standardArg || !reportArg) throw new Error("需要 --standard 和 --report 参数");

const standard = await readStandardWorkbook(path.resolve(standardArg));
const report = await SpreadsheetFile.importXlsx(await FileBlob.load(path.resolve(reportArg)));
const eligible = standard.records
  .filter((record) => isRecordIncludedInReport(record) && ["收入", "支出"].includes(record["交易类型"]))
  .map((record) => ({ ...record, reportDate: reportingDateForRecord(record) }));

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodKey(value, periodType) {
  if (value === "无日期记录") return "无日期";
  let date = value instanceof Date ? value : null;
  if (!date && typeof value === "number" && Number.isFinite(value)) {
    date = new Date((value - 25569) * 86400000);
  }
  if (!date && /^\d{4}-\d{2}(?:-\d{2})?$/.test(String(value ?? ""))) {
    date = new Date(`${String(value).slice(0, 7)}-${String(value).slice(8, 10) || "01"}T00:00:00.000Z`);
  }
  if (!(date instanceof Date) || date.getUTCFullYear() < 2000) return "";
  if (periodType === "day") return dateKey(date);
  if (periodType === "month") return monthKey(date);
  return String(date.getUTCFullYear());
}

function recordPeriodKey(record, periodType) {
  if (!(record.reportDate instanceof Date)) return "无日期";
  if (periodType === "day") return dateKey(record.reportDate);
  if (periodType === "month") return monthKey(record.reportDate);
  return String(record.reportDate.getUTCFullYear());
}

function expectedFor(periodRecords, currency) {
  const matching = periodRecords.filter((record) => record["币种"] === currency);
  const income = matching
    .filter((record) => record["交易类型"] === "收入")
    .reduce((sum, record) => sum + Math.abs(Number(record["金额"])), 0);
  const expense = matching
    .filter((record) => record["交易类型"] === "支出")
    .reduce((sum, record) => sum + Math.abs(Number(record["金额"])), 0);
  return [income, expense, income - expense, matching.length];
}

function numericCellValue(value) {
  // 少数较大公式缓存值被表格引擎还原成 Date；反算 Excel 序号后仍可比较。
  if (value instanceof Date) return value.getTime() / 86400000 + 25569;
  return Number(value);
}

function verifySummarySheet(sheetName, periodType) {
  const sheet = report.worksheets.getItem(sheetName);
  const values = sheet.getUsedRange()?.values ?? [];
  const checks = [];

  for (let labelRow = 0; labelRow < values.length; labelRow += 1) {
    if (values[labelRow + 1]?.[0] !== "个人收支") continue;
    const key = periodKey(values[labelRow]?.[0], periodType);
    if (!key) continue;
    const periodRecords = eligible.filter((record) => recordPeriodKey(record, periodType) === key);

    // 人员数量不同会改变“总体收支”所在行，因此不能写死行号。从本期标题向下
    // 寻找总体块，遇到下一个期间标题就停止，避免读到下一期的数据。
    let overallRow = -1;
    for (let row = labelRow + 1; row < values.length; row += 1) {
      if (values[row]?.[0] === "总体收支") {
        overallRow = row;
        break;
      }
      if (periodKey(values[row]?.[0], periodType)) break;
    }
    if (overallRow < 0) {
      checks.push({ sheetName, period: key, passed: false, reason: "找不到总体收支区块" });
      continue;
    }

    for (const [currency, firstColumn] of [["CNY", 0], ["USD", 6]]) {
      if (values[overallRow + 1]?.[firstColumn] !== currency) continue;
      const actual = values[overallRow + 3]
        .slice(firstColumn, firstColumn + 4)
        .map(numericCellValue);
      const expected = expectedFor(periodRecords, currency);
      const passed = expected.every((value, index) => Math.abs(value - actual[index]) < 0.005);
      checks.push({ sheetName, period: key, currency, expected, actual, passed });
    }
  }
  return checks;
}

const checks = [
  ...verifySummarySheet("日汇总", "day"),
  ...verifySummarySheet("月汇总", "month"),
  ...verifySummarySheet("年汇总", "year"),
];

console.log(JSON.stringify({ eligibleRecords: eligible.length, checks }, null, 2));
if (checks.length === 0 || checks.some((check) => !check.passed)) process.exitCode = 1;
