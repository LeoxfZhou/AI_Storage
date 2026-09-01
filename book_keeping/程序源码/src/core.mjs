import {
  CURRENCIES,
  DATA_STATUSES,
  DIRECTIONS,
  TRANSACTION_TYPES,
} from "./constants.mjs";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function columnName(columnNumber) {
  let name = "";
  let current = columnNumber;
  while (current > 0) {
    current -= 1;
    name = String.fromCharCode(65 + (current % 26)) + name;
    current = Math.floor(current / 26);
  }
  return name;
}

export function trimMatrix(matrix) {
  let lastRow = -1;
  let lastColumn = -1;

  matrix.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value !== null && value !== "") {
        lastRow = Math.max(lastRow, rowIndex);
        lastColumn = Math.max(lastColumn, columnIndex);
      }
    });
  });

  if (lastRow < 0 || lastColumn < 0) return [];
  return matrix.slice(0, lastRow + 1).map((row) => row.slice(0, lastColumn + 1));
}

export function excelSerialToDate(serial) {
  // Excel 的 1900 日期系统把 1899-12-30 当作序号 0。
  // 使用 UTC 可以避免夏令时或本机时区把日期偏移到前一天。
  return new Date(Date.UTC(1899, 11, 30) + Math.trunc(serial) * ONE_DAY_MS);
}

function validUtcDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function extractYearHint(value) {
  const text = String(value ?? "").trim();
  const fourDigit = text.match(/(?:^|\D)(20\d{2})(?:\D|$)/);
  if (fourDigit) return Number(fourDigit[1]);

  // 两位年份只允许出现在字符串开头。否则“6.20”里的 20 会被误当成 2020 年。
  const twoDigit = text.match(/^(1[9]|2\d)(?=[.年/·-])/);
  if (twoDigit) return 2000 + Number(twoDigit[1]);
  return null;
}

export function parseLegacyDate(value, yearHint = null) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { date: value, quality: "原值", reason: "" };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value) && value >= 20000 && value <= 80000) {
      return { date: excelSerialToDate(value), quality: "Excel序号", reason: "" };
    }

    // 旧表把 2 月 12 日写成数值 2.12。没有年份时不能安全统计。
    if (value > 1 && value < 13 && !Number.isInteger(value)) {
      return parseLegacyDate(String(value), yearHint);
    }
  }

  const original = String(value ?? "").trim();
  if (!original) {
    return { date: null, quality: "无效", reason: "缺少日期" };
  }

  // 网页日期编辑器使用 ISO 的 yyyy-mm-dd。它包含连字符，但不是日期范围，
  // 必须在范围识别之前处理，否则用户确认的完整日期会被误判为异常。
  const isoMatch = original.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const date = validUtcDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    return date
      ? { date, quality: "ISO日期", reason: "" }
      : { date: null, quality: "无效", reason: `日期不存在：${original}` };
  }

  const normalized = original
    .replace(/[年月日/·]/g, ".")
    .replace(/\s+/g, "")
    .replace(/\.+$/g, "")
    .replace(/\.{2,}/g, ".");

  // 日期范围不能直接进入按日统计，但应尽量保留成可供用户选择的候选范围。
  // 例如“6.5-8”会变成“2026-06-05 至 2026-06-08”，网页可据此提供选项。
  const rangeInfo = parseDateRange(original, yearHint);
  if (rangeInfo) {
    return {
      date: null,
      candidateRange: rangeInfo,
      quality: "候选范围",
      reason: `日期范围需要用户确认：${original}`,
    };
  }

  let match = normalized.match(/^(20\d{2})\.(\d{1,2})\.(\d{1,2})$/);
  if (match) {
    const date = validUtcDate(Number(match[1]), Number(match[2]), Number(match[3]));
    return date
      ? { date, quality: "原值", reason: "" }
      : { date: null, quality: "无效", reason: `日期不存在：${original}` };
  }

  match = normalized.match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})$/);
  if (match) {
    const date = validUtcDate(2000 + Number(match[1]), Number(match[2]), Number(match[3]));
    return date
      ? { date, quality: "原值", reason: "" }
      : { date: null, quality: "无效", reason: `日期不存在：${original}` };
  }

  match = normalized.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (match && yearHint) {
    const date = validUtcDate(yearHint, Number(match[1]), Number(match[2]));
    return date
      ? { date, quality: "区块年份推断", reason: "" }
      : { date: null, quality: "无效", reason: `日期不存在：${original}` };
  }

  if (match && !yearHint) {
    return { date: null, quality: "无效", reason: `缺少年份：${original}` };
  }

  return { date: null, quality: "无效", reason: `无法识别日期：${original}` };
}

function parseDateRange(value, yearHint) {
  const text = String(value ?? "")
    .trim()
    .replace(/[年月日/·]/g, ".")
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\.+$/g, "");
  if (!text.includes("-")) return null;

  // 支持 6.5-8、6.5-6.8、26.6.5-8 和 2026.6.5-2026.6.8。
  const [left, right] = text.split("-", 2);
  if (!left || !right) return null;
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  let year = yearHint;
  let leftMonth;
  let leftDay;

  if (leftParts.length === 3) {
    year = leftParts[0] < 100 ? 2000 + leftParts[0] : leftParts[0];
    [leftMonth, leftDay] = leftParts.slice(1);
  } else if (leftParts.length === 2 && year) {
    [leftMonth, leftDay] = leftParts;
  } else {
    return null;
  }

  let rightYear = year;
  let rightMonth = leftMonth;
  let rightDay;
  if (rightParts.length === 3) {
    rightYear = rightParts[0] < 100 ? 2000 + rightParts[0] : rightParts[0];
    [rightMonth, rightDay] = rightParts.slice(1);
  } else if (rightParts.length === 2) {
    [rightMonth, rightDay] = rightParts;
  } else if (rightParts.length === 1) {
    [rightDay] = rightParts;
  } else {
    return null;
  }

  const start = validUtcDate(year, leftMonth, leftDay);
  const end = validUtcDate(rightYear, rightMonth, rightDay);
  if (!start || !end || end < start) return null;
  return `${dateToIso(start)} 至 ${dateToIso(end)}`;
}

export function inferBlankDate(previousDate, nextDate) {
  const previousValid = previousDate instanceof Date && !Number.isNaN(previousDate.getTime());
  const nextValid = nextDate instanceof Date && !Number.isNaN(nextDate.getTime());

  if (previousValid && nextValid) {
    const gapDays = Math.round((nextDate.getTime() - previousDate.getTime()) / ONE_DAY_MS);
    if (gapDays >= 0 && gapDays <= 1) {
      return {
        date: previousDate,
        candidateRange: "",
        quality: "继承上一日期",
        reason: "",
      };
    }
    if (gapDays > 1) {
      const candidateRange = `${dateToIso(previousDate)} 至 ${dateToIso(nextDate)}`;
      return {
        date: null,
        candidateRange,
        quality: "相邻日期候选范围",
        reason: `只能根据上下单元格确定范围：${candidateRange}`,
      };
    }
  }

  return {
    date: null,
    candidateRange: "",
    quality: "无效",
    reason: "无法通过上下日期单元格确定日期",
  };
}

export function dateToIso(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  return value.toISOString().slice(0, 10);
}

export function classifyTransaction(description, direction) {
  const text = String(description ?? "");
  if (/上余|期初/.test(text)) return "期初余额";
  if (/购汇|换汇|换美元|购美元/.test(text)) return "换汇";
  if (/红转周|周转红|渊转我|我转渊|周汇红|红汇叶|周汇叶|叶汇红/.test(text)) {
    return "内部转账";
  }
  if (/分账|平账/.test(text)) return "调整";
  if (/还款|归还/.test(text)) return "还款";
  if (/借款|借（欠|借\(欠/.test(text)) return "借款";
  return direction === "流入" ? "收入" : "支出";
}

export function classifyCategory(description) {
  const text = String(description ?? "");
  const rules = [
    [/房租|房费|物业费|摊位/, "房租"],
    [/运费|物流|快递|过路费|车费/, "物流运输"],
    [/菜|饭|餐|酒店|牛奶|矿泉水/, "餐饮"],
    [/水电|电费|水费|煤气/, "水电"],
    [/工资|结账|借支|社保/, "人工"],
    [/税|会计费|手续费/, "税费"],
    [/医院|药|牙齿|医疗/, "医疗"],
    [/维修|配件|修理|油泵|叉车/, "设备维修"],
    [/布|纱|材料|衣架|包装|外箱|纸盒/, "材料"],
    [/借|欠|往来|汇/, "往来款"],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? "未分类";
}

export function isMixedIncomeExpense(description) {
  const text = String(description ?? "");
  const hasIncome = /收|退款|退回|利息/.test(text);
  const hasExpense = /付|买|用|费|菜|饭|运费|快递|物流|借支|维修|缴/.test(text);
  return hasIncome && hasExpense;
}

export function createRecord({
  recordId,
  groupId,
  dateInfo,
  person,
  account,
  type,
  direction,
  amount,
  currency,
  category,
  counterparty = "",
  note = "",
  status = "有效",
  exceptionReason = "",
  originalDate = "",
  originalDescription = "",
  sourceSheet = "",
  sourceCell = "",
  importRule = "",
}) {
  const reasons = [];
  let finalStatus = status;

  if (!dateInfo?.date) reasons.push(dateInfo?.reason || "缺少日期");
  if (!person) reasons.push("缺少人员");
  if (!Number.isFinite(amount) || amount <= 0) reasons.push("金额必须是大于 0 的数字");
  if (!TRANSACTION_TYPES.includes(type)) reasons.push(`未知交易类型：${type}`);
  if (!DIRECTIONS.includes(direction)) reasons.push(`未知方向：${direction}`);
  if (!CURRENCIES.includes(currency)) reasons.push(`未知币种：${currency}`);

  if (reasons.length > 0 && finalStatus === "有效") finalStatus = "待确认";
  const allReasons = [exceptionReason, ...reasons].filter(Boolean);

  return {
    "记录ID": recordId,
    "交易组ID": groupId,
    "日期": dateInfo?.date ?? null,
    "候选日期范围": dateInfo?.candidateRange ?? "",
    "人员": person,
    "账户": account || "未指定账户",
    "交易类型": type,
    "方向": direction,
    "金额": Number.isFinite(amount) ? amount : null,
    "币种": currency,
    "分类": category || "未分类",
    "对方": counterparty,
    "备注": note,
    "数据状态": DATA_STATUSES.includes(finalStatus) ? finalStatus : "待确认",
    "异常原因": [...new Set(allReasons)].join("；"),
    "原始日期": String(originalDate ?? ""),
    "原始描述": String(originalDescription ?? ""),
    "来源工作表": sourceSheet,
    "来源单元格": sourceCell,
    "导入规则": importRule,
  };
}

export function recordKey(record) {
  return [
    dateToIso(record["日期"]),
    record["人员"],
    signedAmount(record),
    record["币种"],
    record["原始描述"] || record["备注"],
  ].join("|");
}

export function signedAmount(record) {
  const amount = Number(record?.["金额"]);
  if (!Number.isFinite(amount)) return null;
  if (record?.["方向"] === "流出") return -Math.abs(amount);
  if (record?.["方向"] === "流入") return Math.abs(amount);
  return amount;
}

export function directionFromSignedAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return null;
  return amount > 0 ? "流入" : "流出";
}

export function markDuplicates(records) {
  const seen = new Map();
  records.forEach((record) => {
    const key = recordKey(record);
    if (!seen.has(key)) {
      seen.set(key, record);
      return;
    }

    // 重复检测只做提示，不自动删除；不同工作表可能确实记录了相同金额。
    record["数据状态"] = "待确认";
    record["异常原因"] = [record["异常原因"], `疑似重复：${seen.get(key)["记录ID"]}`]
      .filter(Boolean)
      .join("；");
  });
  return records;
}

export function getArg(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}
