import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function parseInspection(ndjson) {
  return String(ndjson ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function verifyWorkbook(inputPath, previewDir, rangesBySheet) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
  const sheetInspection = await workbook.inspect({
    kind: "sheet",
    include: "id,name",
    maxChars: 12000,
  });
  const sheetNames = parseInspection(sheetInspection.ndjson).map((item) => item.name);

  // 公式错误扫描覆盖整个工作簿。待确认数据为空不属于错误，但 #REF! 等错误
  // 会使财务汇总失真，因此把它们作为发布前的硬性检查。
  const formulaErrors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 300 },
    summary: "记账工作簿公式错误扫描",
    maxChars: 20000,
  });
  // artifact-tool 在没有匹配项时会返回一条 notice。notice 表示“扫描完成且为零”，
  // 不是公式错误；只把真正的单元格匹配记录计入失败数。
  const errorMatches = parseInspection(formulaErrors.ndjson)
    .filter((item) => item.kind !== "notice");

  await fs.mkdir(previewDir, { recursive: true });
  const previews = [];
  for (const sheetName of sheetNames) {
    // 长流水表可能有上千行。预览表头和代表性数据即可检查字体、列宽、冻结区附近
    // 的结构；直接渲染整张长表会生成难以查看的超高图片，也会浪费大量内存。
    const range = rangesBySheet[sheetName] ?? "A1:J35";
    const image = await workbook.render({ sheetName, range, scale: 1, format: "png" });
    const safeName = sheetName.replaceAll(/[\\/:*?"<>|]/g, "_");
    const previewPath = path.join(previewDir, `${safeName}.png`);
    await fs.writeFile(previewPath, new Uint8Array(await image.arrayBuffer()));
    previews.push(previewPath);
  }

  return { inputPath, sheetNames, errorMatches, previews };
}

const standardPath = path.resolve(getArg("--standard"));
const reportPath = path.resolve(getArg("--report"));
const templatePath = path.resolve(getArg("--template"));
const previewRoot = path.resolve(getArg("--preview-dir", "outputs/previews"));

const standardRanges = {
  "填写说明": "A1:B24",
  "标准流水": "A1:S24",
  "异常记录": "A1:H24",
  "导入日志": "A1:E14",
  "对账基准": "A1:F20",
  "人员字典": "A1:B25",
  "账户字典": "A1:B25",
  "分类字典": "A1:B25",
};
const reportRanges = {
  "简洁流水": "A1:J50",
  "日汇总": "A1:J55",
  "月汇总": "A1:J55",
  "年汇总": "A1:J55",
  "完整数据": "A1:U24",
};

const results = [];
results.push(await verifyWorkbook(templatePath, path.join(previewRoot, "template"), standardRanges));
results.push(await verifyWorkbook(standardPath, path.join(previewRoot, "standard"), standardRanges));
results.push(await verifyWorkbook(reportPath, path.join(previewRoot, "report"), reportRanges));

const totalErrors = results.reduce((count, result) => count + result.errorMatches.length, 0);
console.log(JSON.stringify({ totalErrors, workbooks: results }, null, 2));
if (totalErrors > 0) process.exitCode = 1;
