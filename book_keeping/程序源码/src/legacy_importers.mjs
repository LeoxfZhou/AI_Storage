import {
  classifyCategory,
  classifyTransaction,
  columnName,
  createRecord,
  extractYearHint,
  inferBlankDate,
  isMixedIncomeExpense,
  parseLegacyDate,
} from "./core.mjs";

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function joinReasons(...reasons) {
  return reasons.filter(Boolean).join("；");
}

function readSheet(workbook, name) {
  const sheet = workbook.worksheets.getItem(name);
  const usedRange = sheet.getUsedRange();
  return {
    sheet,
    values: usedRange?.values ?? [],
    formulas: usedRange?.formulas ?? [],
  };
}

function nextExplicitDate(values, startRow, endRow, dateColumn, yearHint) {
  for (let row = startRow; row < endRow; row += 1) {
    const rawDate = values[row]?.[dateColumn];
    if (String(rawDate ?? "").trim() === "日期") break;
    if (rawDate === null || rawDate === "") continue;
    const parsed = parseLegacyDate(rawDate, yearHint);
    if (parsed.date) return parsed.date;
  }
  return null;
}

function dateInfoForRow(values, row, endRow, dateColumn, yearHint, previousExplicitDate) {
  const rawDate = values[row]?.[dateColumn];
  if (rawDate !== null && rawDate !== "") return parseLegacyDate(rawDate, yearHint);

  // 空白日期先查看上下明确日期。相邻两天之间的空白行继承上一天；跨度较大时
  // 只生成候选范围，不能为了减少异常而随意选择某一天。
  const followingDate = nextExplicitDate(values, row + 1, endRow, dateColumn, yearHint);
  return inferBlankDate(previousExplicitDate, followingDate);
}

function classifyImportedRecord(description, direction) {
  let type = classifyTransaction(description, direction);
  let status = "有效";
  let reason = "";

  // 原始说明同时出现“收”和明显支出词时，单个净额不能还原毛收入、毛支出。
  // 将它作为待确认的调整项，避免程序凭描述强行拆分后把年度收支放大或缩小。
  if (["收入", "支出"].includes(type) && isMixedIncomeExpense(description)) {
    type = "调整";
    status = "待确认";
    reason = "原始说明同时包含收入和支出，净额无法安全拆分";
  }

  return { type, status, reason };
}

export function importFactoryLedger(workbook) {
  const sourceSheet = "厂收支明细";
  const { values, formulas } = readSheet(workbook, sourceSheet);
  const records = [];
  const reconciliation = [];

  const headerRow = values.findIndex((row) => row.some((value) => value === "日期"));
  if (headerRow < 0) {
    return {
      records,
      reconciliation,
      log: { sheet: sourceSheet, status: "失败", detail: "找不到日期表头", imported: 0 },
    };
  }

  const blocks = [];
  for (let column = 0; column < (values[headerRow]?.length ?? 0); column += 1) {
    if (values[headerRow]?.[column] !== "日期") continue;
    if (values[headerRow]?.[column + 1] !== "收支名目") continue;

    const totalOffset = values[headerRow]
      .slice(column + 2, column + 8)
      .findIndex((value) => value === "总");
    if (totalOffset < 0) continue;

    const totalColumn = column + 2 + totalOffset;
    const peopleColumns = [];
    for (let personColumn = column + 2; personColumn < totalColumn; personColumn += 1) {
      const person = String(values[headerRow]?.[personColumn] ?? "").trim();
      if (person) peopleColumns.push({ person, column: personColumn });
    }
    if (peopleColumns.length > 0) {
      blocks.push({ startColumn: column, totalColumn, peopleColumns });
    }
  }

  // 部分横向区块只写“9.15”这类月日，因此先从每个区块开头寻找明确年份；
  // 找不到时沿用前一区块。年份不能从备注里猜，因为“借支2000”更可能是金额，
  // 如果把它当成年份，会把本应属于 2025 年的交易错误统计到 2000 年。
  let previousBlockYear = null;
  const blockYearHints = blocks.map((block) => {
    let detectedYear = null;
    const firstDataRow = headerRow + 1;
    const scanEndRow = Math.min(values.length, firstDataRow + 12);

    for (let row = firstDataRow; row < scanEndRow; row += 1) {
      const parsed = parseLegacyDate(values[row]?.[block.startColumn], null);
      if (parsed.date) {
        detectedYear = parsed.date.getUTCFullYear();
        break;
      }
    }

    const resolvedYear = detectedYear ?? previousBlockYear;
    if (resolvedYear) previousBlockYear = resolvedYear;
    return resolvedYear;
  });

  for (const [blockIndex, block] of blocks.entries()) {
    let yearHint = blockYearHints[blockIndex] ?? null;
    let openingTotal = null;
    let sourceEnd = null;
    let movementSum = 0;
    let started = false;
    let blankStreak = 0;
    let processedRows = 0;
    let previousExplicitDate = null;

    for (let row = headerRow + 1; row < values.length; row += 1) {
      const rawDate = values[row]?.[block.startColumn];
      const description = String(values[row]?.[block.startColumn + 1] ?? "").trim();
      const totalValue = numberOrNull(values[row]?.[block.totalColumn]);
      const totalFormula = formulas[row]?.[block.totalColumn];
      const hasPersonFormula = block.peopleColumns.some(({ column }) => Boolean(formulas[row]?.[column]));
      const personAmounts = block.peopleColumns
        .map(({ person, column }) => ({ person, column, value: numberOrNull(values[row]?.[column]) }))
        .filter(({ value }) => value !== null && value !== 0);

      const hasContent = rawDate !== null && rawDate !== "" || description || personAmounts.length > 0;
      if (!hasContent && !totalFormula) {
        blankStreak += 1;
        if (started && blankStreak >= 4) break;
        continue;
      }
      blankStreak = 0;

      if (String(rawDate ?? "").trim() === "日期") break;
      if (!started && !hasContent) continue;
      started = true;

      // 旧表在流水区块下方放了人员合计和历年分账。金额列出现公式通常表示
      // 已经进入汇总区；但第一行“上余”也可能通过公式承接前一区块余额，
      // 所以只有处理过至少一行后，才把公式金额行当成区块结束。
      if (
        (processedRows > 0 && hasPersonFormula) ||
        (!rawDate && !description && personAmounts.length > 0)
      ) break;

      // 只信任日期单元格中的年份，备注里的四位数字通常是金额或数量。
      const explicitYear = extractYearHint(rawDate);
      if (explicitYear) yearHint = explicitYear;
      const dateInfo = dateInfoForRow(
        values, row, values.length, block.startColumn, yearHint, previousExplicitDate,
      );
      if (dateInfo.date) yearHint = dateInfo.date.getUTCFullYear();
      if (rawDate !== null && rawDate !== "" && dateInfo.date) previousExplicitDate = dateInfo.date;

      const isOpeningRow = /上余|期初|分账.*后/.test(description) && openingTotal === null;
      if (isOpeningRow && totalValue !== null) openingTotal = totalValue;
      if (totalValue !== null && (totalFormula || isOpeningRow)) sourceEnd = totalValue;

      const looksLikeSummary =
        !rawDate &&
        (/^周.*叶.*共/.test(description) || /各得|共分|买厂房投/.test(description));

      for (const { person, column, value } of personAmounts) {
        if (!isOpeningRow) movementSum += value;

        const direction = value >= 0 ? "流入" : "流出";
        const imported = classifyImportedRecord(description, direction);
        const status = looksLikeSummary ? "忽略" : imported.status;
        const summaryReason = looksLikeSummary ? "疑似分账或汇总说明，默认不作为日常流水" : "";
        const groupId = `FAC-B${blockIndex + 1}-R${row + 1}`;

        records.push(createRecord({
          recordId: `${groupId}-${person}`,
          groupId,
          dateInfo,
          person,
          account: "人民币账户",
          type: isOpeningRow ? "期初余额" : imported.type,
          direction,
          amount: Math.abs(value),
          currency: "CNY",
          category: isOpeningRow ? "往来款" : classifyCategory(description),
          note: description,
          status,
          exceptionReason: joinReasons(imported.reason, summaryReason),
          originalDate: rawDate,
          originalDescription: description,
          sourceSheet,
          sourceCell: `${columnName(column + 1)}${row + 1}`,
          importRule: `工厂横向区块 ${blockIndex + 1}；人员列 ${person}；${dateInfo.quality}`,
        }));
      }

      processedRows += 1;
    }

    const calculatedEnd = openingTotal === null ? null : openingTotal + movementSum;
    const difference = sourceEnd !== null && calculatedEnd !== null ? calculatedEnd - sourceEnd : null;
    reconciliation.push({
      sourceSheet,
      scope: `工厂区块 ${blockIndex + 1} (${columnName(block.startColumn + 1)}:${columnName(block.totalColumn + 1)})`,
      sourceValue: sourceEnd,
      calculatedValue: calculatedEnd,
      difference,
      status: difference !== null && Math.abs(difference) <= 0.01 ? "通过" : "待确认",
      note: "期初总额 + 各人员后续净变动，应等于区块最后累计总额",
    });
  }

  return {
    records,
    reconciliation,
    log: {
      sheet: sourceSheet,
      status: "已导入",
      detail: `识别 ${blocks.length} 个横向流水区块`,
      imported: records.length,
    },
  };
}

function parsePersonCurrency(header) {
  const text = String(header ?? "").replace(/\s+/g, "");
  if (!text) return null;
  const person = text[0];
  if (!/[周红叶渊]/.test(person)) return null;
  const currency = /\$/.test(text) ? "USD" : "CNY";
  return { person, currency, account: currency === "USD" ? "美元账户" : "人民币账户" };
}

export function importPersonalLedger(workbook) {
  const sourceSheet = "自己明细";
  const { values, formulas } = readSheet(workbook, sourceSheet);
  const records = [];
  const reconciliation = [];

  const headerRows = values
    .map((row, index) => ({ index, row }))
    .filter(({ row }) => row?.[0] === "日期" && row?.[1] === "用途")
    .map(({ index }) => index);

  for (const [blockIndex, headerRow] of headerRows.entries()) {
    const nextHeader = headerRows[blockIndex + 1] ?? values.length;
    const personColumns = values[headerRow]
      .map((header, column) => ({ column, parsed: parsePersonCurrency(header) }))
      .filter(({ parsed }) => parsed);

    let yearHint = null;
    let previousExplicitDate = null;
    const sums = new Map(personColumns.map(({ column }) => [column, 0]));
    let totalRow = null;

    for (let row = headerRow + 1; row < nextHeader; row += 1) {
      const rawDate = values[row]?.[0];
      const description = String(values[row]?.[1] ?? "").trim();
      const hasAmounts = personColumns.some(({ column }) => numberOrNull(values[row]?.[column]) !== null);

      // 日期和用途同时为空、但金额列有数字或公式，通常就是旧表的小计行。
      if (!rawDate && !description && hasAmounts) {
        totalRow = row;
        break;
      }
      if (!rawDate && !description && !hasAmounts) continue;

      const explicitYear = extractYearHint(rawDate);
      if (explicitYear) yearHint = explicitYear;
      const dateInfo = dateInfoForRow(values, row, nextHeader, 0, yearHint, previousExplicitDate);
      if (dateInfo.date) yearHint = dateInfo.date.getUTCFullYear();
      if (rawDate !== null && rawDate !== "" && dateInfo.date) previousExplicitDate = dateInfo.date;
      const groupId = `PER-B${blockIndex + 1}-R${row + 1}`;

      for (const { column, parsed } of personColumns) {
        const value = numberOrNull(values[row]?.[column]);
        if (value === null || value === 0) continue;
        sums.set(column, (sums.get(column) ?? 0) + value);

        const direction = value >= 0 ? "流入" : "流出";
        const imported = classifyImportedRecord(description, direction);
        records.push(createRecord({
          recordId: `${groupId}-${columnName(column + 1)}`,
          groupId,
          dateInfo,
          person: parsed.person,
          account: parsed.account,
          type: imported.type,
          direction,
          amount: Math.abs(value),
          currency: parsed.currency,
          category: classifyCategory(description),
          note: description,
          status: imported.status,
          exceptionReason: imported.reason,
          originalDate: rawDate,
          originalDescription: description,
          sourceSheet,
          sourceCell: `${columnName(column + 1)}${row + 1}`,
          importRule: `个人明细区块 ${blockIndex + 1}；${parsed.person}/${parsed.currency}；${dateInfo.quality}`,
        }));
      }
    }

    for (const { column, parsed } of personColumns) {
      const sourceTotal = totalRow === null ? null : numberOrNull(values[totalRow]?.[column]);
      const calculated = sums.get(column) ?? 0;
      const difference = sourceTotal === null ? null : calculated - sourceTotal;
      reconciliation.push({
        sourceSheet,
        scope: `个人区块 ${blockIndex + 1} ${parsed.person}/${parsed.currency}`,
        sourceValue: sourceTotal,
        calculatedValue: calculated,
        difference,
        status: difference !== null && Math.abs(difference) <= 0.01 ? "通过" : "待确认",
        note: totalRow === null ? "未找到旧表小计行" : `旧表小计行 ${totalRow + 1}`,
      });
    }
  }

  return {
    records,
    reconciliation,
    log: {
      sheet: sourceSheet,
      status: "已导入",
      detail: `识别 ${headerRows.length} 个个人明细区块`,
      imported: records.length,
    },
  };
}

export function importYiwuLedger(workbook) {
  const sourceSheet = "义乌流水";
  const { values } = readSheet(workbook, sourceSheet);
  const records = [];
  const reconciliation = [];
  const headerRow = values.findIndex((row) => row?.[0] === "日期" && row?.[1] === "收支名目");

  if (headerRow < 0) {
    return {
      records,
      reconciliation,
      log: { sheet: sourceSheet, status: "失败", detail: "找不到主流水表头", imported: 0 },
    };
  }

  const mappings = [
    { column: 2, person: "红", direction: "流出", type: "支出" },
    { column: 3, person: "红", direction: "流入", type: "收入" },
    { column: 4, person: "周", direction: "流出", type: "支出" },
    { column: 5, person: "周", direction: "流入", type: "收入" },
  ];
  let yearHint = null;
  let previousExplicitDate = null;
  let calculatedTotal = 0;
  let sourceTotal = null;

  for (let row = headerRow + 1; row < values.length; row += 1) {
    if ([2, 3, 4, 5].some((column) => /红支|红收|周支|周收/.test(String(values[row]?.[column] ?? "")))) {
      break;
    }

    const rawDate = values[row]?.[0];
    const description = String(values[row]?.[1] ?? "").trim();
    const hasAmounts = mappings.some(({ column }) => numberOrNull(values[row]?.[column]) !== null);
    if (!rawDate && !description && hasAmounts) break;
    if (!rawDate && !description && !hasAmounts) continue;

    const explicitYear = extractYearHint(rawDate);
    if (explicitYear) yearHint = explicitYear;
    const dateInfo = dateInfoForRow(values, row, values.length, 0, yearHint, previousExplicitDate);
    if (dateInfo.date) yearHint = dateInfo.date.getUTCFullYear();
    if (rawDate !== null && rawDate !== "" && dateInfo.date) previousExplicitDate = dateInfo.date;
    const groupId = `YIW-MAIN-R${row + 1}`;

    for (const mapping of mappings) {
      const rawAmount = numberOrNull(values[row]?.[mapping.column]);
      if (rawAmount === null || rawAmount === 0) continue;
      const amount = Math.abs(rawAmount);
      calculatedTotal += mapping.direction === "流入" ? amount : -amount;

      records.push(createRecord({
        recordId: `${groupId}-${columnName(mapping.column + 1)}`,
        groupId,
        dateInfo,
        person: mapping.person,
        account: "人民币账户",
        type: mapping.type,
        direction: mapping.direction,
        amount,
        currency: "CNY",
        category: classifyCategory(description),
        note: description,
        originalDate: rawDate,
        originalDescription: description,
        sourceSheet,
        sourceCell: `${columnName(mapping.column + 1)}${row + 1}`,
        importRule: `义乌主流水 ${mapping.person}${mapping.type}列；${dateInfo.quality}`,
      }));
    }

    const rollingTotal = numberOrNull(values[row]?.[6]);
    if (rollingTotal !== null) sourceTotal = rollingTotal;
  }

  reconciliation.push({
    sourceSheet,
    scope: "义乌主流水累计总额",
    sourceValue: sourceTotal,
    calculatedValue: calculatedTotal,
    difference: sourceTotal === null ? null : calculatedTotal - sourceTotal,
    status: sourceTotal !== null && Math.abs(calculatedTotal - sourceTotal) <= 0.01 ? "通过" : "待确认",
    note: "红收 + 周收 - 红支 - 周支，应等于 G 列最后累计总额",
  });

  // I:K 是独立的“买菜吃饭”小表。归属人员和是否已计入主流水都不明确，
  // 所以完整保留为待确认记录，不让它自动进入报表。
  let foodYearHint = null;
  let previousFoodDate = null;
  for (let row = headerRow + 1; row < values.length; row += 1) {
    const rawDate = values[row]?.[8];
    const description = String(values[row]?.[9] ?? "").trim();
    const amount = numberOrNull(values[row]?.[10]);
    if (!rawDate && !description && amount === null) continue;

    const explicitYear = extractYearHint(rawDate);
    if (explicitYear) foodYearHint = explicitYear;
    const dateInfo = dateInfoForRow(values, row, values.length, 8, foodYearHint, previousFoodDate);
    if (dateInfo.date) foodYearHint = dateInfo.date.getUTCFullYear();
    if (rawDate !== null && rawDate !== "" && dateInfo.date) previousFoodDate = dateInfo.date;

    records.push(createRecord({
      recordId: `YIW-FOOD-R${row + 1}`,
      groupId: `YIW-FOOD-R${row + 1}`,
      dateInfo,
      person: "公共",
      account: "人民币账户",
      type: "支出",
      direction: "流出",
      amount: amount === null ? null : Math.abs(amount),
      currency: "CNY",
      category: "餐饮",
      note: description,
      status: "待确认",
      exceptionReason: "买菜吃饭小表归属人员及是否与主流水重复尚未确认",
      originalDate: rawDate,
      originalDescription: description,
      sourceSheet,
      sourceCell: `I${row + 1}:K${row + 1}`,
      importRule: `义乌买菜吃饭小表；${dateInfo.quality}`,
    }));
  }

  return {
    records,
    reconciliation,
    log: {
      sheet: sourceSheet,
      status: "已导入",
      detail: "主流水已标准化；买菜吃饭小表保留为待确认",
      imported: records.length,
    },
  };
}

export async function buildSheetClassificationLog(workbook) {
  const classifications = new Map([
    ["厂收支明细", "原始流水：由工厂适配器导入"],
    ["自己明细", "原始流水：由个人适配器导入"],
    ["义乌流水", "原始流水：由义乌适配器导入"],
    ["19+厂流水总", "历史汇总：不导入，仅作人工对账参考"],
    ["自己", "历史汇总或旧版整理表：不导入，避免与自己明细重复"],
    ["计算", "辅助计算：不导入"],
    ["生活小计", "非财务流水：中药清单，排除"],
    ["包装袋19", "业务台账：排除"],
    ["做盒子19", "业务台账：排除"],
    ["库存统计19", "库存台账：排除"],
  ]);

  const inspection = await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 10000 });
  const records = inspection.ndjson
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return records.map(({ name }) => ({
    sheet: name,
    status: classifications.has(name) ? "已分类" : "待确认",
    detail: classifications.get(name) ?? "未配置的工作表，默认不导入",
    imported: 0,
  }));
}
