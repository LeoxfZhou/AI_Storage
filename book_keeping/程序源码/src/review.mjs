import fs from "node:fs/promises";
import {
  createRecord,
  dateToIso,
  directionFromSignedAmount,
  parseLegacyDate,
  signedAmount,
} from "./core.mjs";

export function tokenizeDescription(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];

  // 先在数字两侧放分隔符，再按空格和常见中英文标点切分。正负号与紧随其后的
  // 数字保持为同一个词块，使用户可以直接把“+20”或“-35”放进金额单元格。
  return text
    .replace(/([+-]?\d+(?:\.\d+)?)/g, "|$1|")
    .split(/[|\s，,、；;：:（）()【】\[\]]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function candidateStartDate(record) {
  const start = String(record?.["候选日期范围"] ?? "").match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return start ? parseLegacyDate(start, null).date : null;
}

function isDateOnlyReason(reason) {
  return /日期|上下单元格|候选范围/.test(reason);
}

function isStructurallyCompleteForReporting(record) {
  const amount = Number(record?.["金额"]);
  const direction = record?.["方向"];
  const type = record?.["交易类型"];
  const signMatchesType = !(
    (type === "收入" && direction === "流出")
    || (type === "支出" && direction === "流入")
  );
  return Boolean(
    String(record?.["人员"] ?? "").trim()
    && String(record?.["账户"] ?? "").trim()
    && Number.isFinite(amount)
    && amount > 0
    && ["CNY", "USD"].includes(record?.["币种"])
    && ["收入", "支出"].includes(type)
    && ["流入", "流出"].includes(direction)
    && signMatchesType
  );
}

export function reviewPriorityForRecord(record) {
  if (record?.["数据状态"] !== "待确认") return "";
  const reasons = String(record["异常原因"] ?? "")
    .split("；")
    .map((reason) => reason.trim())
    .filter(Boolean);
  // 日期只决定记录能否归入某日、某月或某年，并不影响金额与人员是否可靠。
  // 因此“只有日期问题”的记录一律是低优先级：有候选范围时暂用范围起点，
  // 完全没有日期时放进报表末尾的“无日期”区块，绝不为了统计而捏造日期。
  const onlyDateUncertainty = reasons.length > 0 && reasons.every(isDateOnlyReason);
  return isStructurallyCompleteForReporting(record) && onlyDateUncertainty ? "低" : "高";
}

export function reportingDateForRecord(record) {
  if (record?.["日期"] instanceof Date && !Number.isNaN(record["日期"].getTime())) return record["日期"];
  return reviewPriorityForRecord(record) === "低" ? candidateStartDate(record) : null;
}

export function isRecordIncludedInReport(record) {
  if (record?.["数据状态"] === "忽略") return false;
  return record?.["数据状态"] === "有效" || reviewPriorityForRecord(record) === "低";
}

export function inferTransactionNote(record) {
  const original = String(record?.["原始描述"] || record?.["备注"] || "").trim();
  if (!original) return "";
  const amount = Math.abs(Number(signedAmount(record)));
  if (!Number.isFinite(amount) || amount === 0) return String(record?.["备注"] || original);

  // 先按逗号、顿号和分号切成自然交易片段，再用该行金额定位最可能的备注。
  // 例如“菜150，收布碎77”会让 -150 对应“菜150”，+77 对应“收布碎77”。
  const segments = original.split(/[，,、；;]+/u).map((value) => value.trim()).filter(Boolean);
  const amountMatches = segments.filter((segment) => [...segment.matchAll(/[+-]?\d+(?:\.\d+)?/g)]
    .some((match) => Math.abs(Number(match[0])) === amount));
  if (amountMatches.length === 0) return String(record?.["备注"] || original);
  if (amountMatches.length === 1) return amountMatches[0];

  // 同一金额出现多次时，再用“收/退”等收入语义或“付/买/费”等支出语义消歧。
  const direction = record?.["方向"];
  const directionPattern = direction === "流入"
    ? /收|退款|退回|利息/u
    : /付|买|用|费|菜|饭|运|快递|物流|借支|维修|缴/u;
  return amountMatches.find((segment) => directionPattern.test(segment)) || amountMatches[0];
}

function recordToReviewRow(record) {
  const candidateDateRange = record["候选日期范围"] || "";
  return {
    recordId: record["记录ID"],
    date: dateToIso(record["日期"]),
    candidateDateRange,
    // 日期范围仍不能唯一确定日期，但用范围起点作为网页日期控件的默认建议，
    // 可以减少用户点击次数。只有用户按“确认并纳入”后它才真正进入统计。
    estimatedDate: dateToIso(record["日期"]) || candidateDateRange.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "",
    person: record["人员"] || "",
    amount: signedAmount(record),
    transactionType: record["交易类型"] || "",
    category: record["分类"] === "未分类" ? "" : (record["分类"] || ""),
    currency: record["币种"] || "CNY",
    account: record["账户"] || "未指定账户",
    note: inferTransactionNote(record),
  };
}

function describePeople(records, direction) {
  const descriptions = records
    .filter((record) => record["方向"] === direction)
    .map((record) => {
      const person = String(record["人员"] || "未填写").trim();
      const amount = signedAmount(record);
      return Number.isFinite(amount) && amount !== 0 ? `${person}（${amount > 0 ? "+" : ""}${amount}）` : person;
    });
  return [...new Set(descriptions)].join("、");
}

export function buildReviewGroups(records) {
  const groups = new Map();
  for (const record of records.filter((item) => item["数据状态"] === "待确认")) {
    const groupId = record["交易组ID"] || record["记录ID"];
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        groupId,
        sourceSheet: record["来源工作表"],
        sourceCell: record["来源单元格"],
        originalDate: record["原始日期"],
        originalDescription: record["原始描述"] || record["备注"],
        exceptionReason: record["异常原因"],
        candidateDateRange: record["候选日期范围"] || "",
        tokens: tokenizeDescription(record["原始描述"] || record["备注"]),
        rows: [],
        _originalRecords: [],
      });
    }
    const group = groups.get(groupId);
    group.rows.push(recordToReviewRow(record));
    group._originalRecords.push(record);
    group.exceptionReason = [...new Set(
      [group.exceptionReason, record["异常原因"]].filter(Boolean).flatMap((reason) => reason.split("；")),
    )].join("；");
  }
  return [...groups.values()].map((group) => {
    const originalIncomePeople = describePeople(group._originalRecords, "流入");
    const originalExpensePeople = describePeople(group._originalRecords, "流出");
    const estimatedDate = group.rows.find((row) => row.date)?.date
      || group.rows.find((row) => row.estimatedDate)?.estimatedDate
      || "";
    const priority = group._originalRecords.some((record) => reviewPriorityForRecord(record) === "高") ? "高" : "低";
    const priorityMessage = priority === "高"
      ? "缺少第二步统计所需的可靠信息；处理前不会计入报表"
      : estimatedDate
        ? "仅日期需要确认；暂不处理也会按预估日期计入报表"
        : "仅缺少日期；暂不处理也会计入报表末尾的无日期区块";
    const { _originalRecords, ...publicGroup } = group;
    return { ...publicGroup, originalIncomePeople, originalExpensePeople, estimatedDate, priority, priorityMessage };
  }).sort((left, right) => Number(right.priority === "高") - Number(left.priority === "高"));
}

function serializeRecord(record) {
  return {
    ...record,
    "日期": dateToIso(record["日期"]),
  };
}

function deserializeRecord(record) {
  return {
    ...record,
    "日期": record["日期"] ? parseLegacyDate(record["日期"], null).date : null,
  };
}

export async function saveReviewState(filePath, state) {
  // sourceRecords 是每次重新计算的不可变基线。若只保存最新 records，用户把
  // “确认并纳入”改回“暂不处理”时，原始异常行已经被网页拆分行覆盖，无法恢复。
  const sourceRecords = state.sourceRecords ?? state.records;
  await fs.writeFile(filePath, JSON.stringify({
    ...state,
    records: state.records.map(serializeRecord),
    sourceRecords: sourceRecords.map(serializeRecord),
    reviewDecisions: state.reviewDecisions ?? [],
  }, null, 2));
}

export async function loadReviewState(filePath) {
  const state = JSON.parse(await fs.readFile(filePath, "utf8"));
  const sourceRecords = state.sourceRecords ?? state.records;
  return {
    ...state,
    records: state.records.map(deserializeRecord),
    // 兼容升级前生成的 review-state.json：旧文件没有 sourceRecords，
    // 此时只能把当时的 records 作为初始基线，但不会因此读取失败。
    sourceRecords: sourceRecords.map(deserializeRecord),
    reviewDecisions: Array.isArray(state.reviewDecisions) ? state.reviewDecisions : [],
  };
}

function recordsFromConfirmedRows(groupId, originalRecords, rows) {
  const reference = originalRecords[0];
  return rows.map((row, index) => {
    const signed = Number(row.amount);
    const direction = directionFromSignedAmount(signed);
    const inferredType = direction === "流入" ? "收入" : direction === "流出" ? "支出" : "";
    const selectedType = row.transactionType || inferredType;
    const mismatch =
      (selectedType === "收入" && direction === "流出") ||
      (selectedType === "支出" && direction === "流入");
    const dateInfo = parseLegacyDate(row.date, null);

    // 浏览器端已经会校验这些字段，但服务端仍需再次验证。只依赖前端校验时，
    // 刷新、旧页面或手工请求都可能把不完整记录标成“有效”并混入财务统计。
    // 日期允许留空：它会作为低优先级记录进入“无日期”区块。若用户填写了日期，
    // 则必须是合法日期，避免把拼写错误误当成“主动留空”。
    if (String(row.date ?? "").trim() && !(dateInfo.date instanceof Date)) {
      throw new Error(`异常组 ${groupId} 的日期无效`);
    }
    if (!String(row.person ?? "").trim()) throw new Error(`异常组 ${groupId} 缺少人员`);
    if (!Number.isFinite(signed) || signed === 0) throw new Error(`异常组 ${groupId} 的金额必须是非零数字`);
    if (mismatch) throw new Error(`异常组 ${groupId} 的交易类型与金额正负号不一致`);

    return createRecord({
      recordId: `${groupId}-WEB-${index + 1}`,
      groupId,
      dateInfo,
      person: String(row.person ?? "").trim(),
      account: row.account || reference?.["账户"] || "未指定账户",
      type: selectedType,
      direction,
      amount: Number.isFinite(signed) ? Math.abs(signed) : null,
      currency: row.currency || reference?.["币种"] || "CNY",
      category: row.category || "未分类",
      note: row.note || reference?.["备注"] || "",
      status: "有效",
      exceptionReason: "",
      originalDate: reference?.["原始日期"] || "",
      originalDescription: reference?.["原始描述"] || "",
      sourceSheet: reference?.["来源工作表"] || "网页拆分",
      sourceCell: reference?.["来源单元格"] || "",
      importRule: "网页异常复核与拆分",
    });
  });
}

export function applyReviewResolutions(records, resolutions = []) {
  const resolutionMap = new Map(resolutions.map((resolution) => [resolution.groupId, resolution]));
  const groupedOriginals = new Map();
  for (const record of records) {
    const groupId = record["交易组ID"] || record["记录ID"];
    if (!groupedOriginals.has(groupId)) groupedOriginals.set(groupId, []);
    groupedOriginals.get(groupId).push(record);
  }

  const result = [];
  for (const [groupId, originals] of groupedOriginals) {
    const resolution = resolutionMap.get(groupId);
    if (!resolution) {
      // 返回副本，避免后续 markDuplicates 修改 sourceRecords。sourceRecords 必须保持
      // 不可变，否则下一次重新选择处理方式时就不再是真正的原始异常数据。
      result.push(...originals.map((record) => ({ ...record })));
      continue;
    }
    if (resolution.action === "ignore") {
      result.push(...originals.map((record) => ({
        ...record,
        "数据状态": "忽略",
        "异常原因": [record["异常原因"], "用户在网页中选择忽略"].filter(Boolean).join("；"),
      })));
      continue;
    }
    if (resolution.action === "defer") {
      // “暂不处理”是一项明确决定，所以会进入已处理区域；财务上仍保持待确认，
      // 不会被第二步报表误算。用户以后可以随时改成确认或忽略。
      result.push(...originals.map((record) => ({ ...record })));
      continue;
    }
    if (resolution.action !== "confirm") {
      throw new Error(`异常组 ${groupId} 的处理方式无效`);
    }
    if (!Array.isArray(resolution.rows) || resolution.rows.length === 0) {
      throw new Error(`异常组 ${groupId} 确认纳入时至少需要一行`);
    }
    result.push(...recordsFromConfirmedRows(groupId, originals, resolution.rows ?? []));
  }
  return result;
}

export function mergeReviewDecisions(existing = [], updates = []) {
  const decisionMap = new Map(existing.map((decision) => [decision.groupId, decision]));
  for (const decision of updates) {
    if (!decision?.groupId) continue;
    if (!["confirm", "defer", "ignore"].includes(decision.action)) {
      throw new Error(`异常组 ${decision.groupId} 的处理方式无效`);
    }
    decisionMap.set(decision.groupId, decision);
  }
  return [...decisionMap.values()];
}

export function buildReviewCollections(state) {
  const originalGroups = buildReviewGroups(state.sourceRecords ?? state.records ?? []);
  const decisions = new Map((state.reviewDecisions ?? []).map((decision) => [decision.groupId, decision]));
  const pendingGroups = [];
  const processedGroups = [];

  for (const group of originalGroups) {
    const decision = decisions.get(group.groupId);
    if (!decision) {
      pendingGroups.push(group);
      continue;
    }
    // 决定中保存的是用户最近编辑的拆分表格。忽略或暂不处理时这些行不参与
    // 计算，但继续保留，方便用户稍后切换到“确认并纳入”而不用重新填写。
    processedGroups.push({
      ...group,
      action: decision.action,
      rows: Array.isArray(decision.rows) && decision.rows.length ? decision.rows : group.rows,
    });
  }
  return { reviewGroups: pendingGroups, processedGroups };
}
