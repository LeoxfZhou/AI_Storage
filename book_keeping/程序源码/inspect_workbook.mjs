#!/usr/bin/env node
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import { getArg } from "./src/core.mjs";

const args = process.argv.slice(2);
const inputArg = getArg(args, "--input", null);
// path.resolve("") 会悄悄变成当前目录，所以必须在 resolve 之前检查参数。
// 否则用户漏写 --input 时只会看到难懂的“无法读取目录”错误。
if (!inputArg) throw new Error("缺少 --input 参数");
const inputPath = path.resolve(inputArg);

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const inspection = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 12000 });
const sheets = inspection.ndjson
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .map(({ name }) => name);

const supportedLegacySheets = new Set(["厂收支明细", "自己明细", "义乌流水"]);
console.log(JSON.stringify({
  input: inputPath,
  kind: sheets.includes("标准流水") && sheets.includes("填写说明") ? "standard" : "legacy",
  sheets: sheets.map((name) => ({
    name,
    supported: supportedLegacySheets.has(name),
    selectedByDefault: supportedLegacySheets.has(name),
  })),
}, null, 2));
