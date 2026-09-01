import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCategory,
  classifyTransaction,
  createRecord,
  dateToIso,
  inferBlankDate,
  markDuplicates,
  parseLegacyDate,
  signedAmount,
} from "../src/core.mjs";
import {
  applyReviewResolutions,
  buildReviewCollections,
  buildReviewGroups,
  inferTransactionNote,
  isRecordIncludedInReport,
  mergeReviewDecisions,
  reportingDateForRecord,
  reviewPriorityForRecord,
  tokenizeDescription,
} from "../src/review.mjs";
import {
  buildRuleImprovementSamples,
  recordReviewDecisions,
  restoreReviewDecisions,
  reviewGroupFingerprint,
} from "../src/review_history.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("完整两位年份日期会转换成 20xx 年", () => {
  const result = parseLegacyDate("25.1.28");
  assert.equal(dateToIso(result.date), "2025-01-28");
  assert.equal(result.quality, "原值");
});

test("月日格式只有在年份上下文明确时才允许补全", () => {
  assert.equal(parseLegacyDate(2.4).date, null);
  assert.equal(dateToIso(parseLegacyDate(2.4, 2025).date), "2025-02-04");
  assert.equal(dateToIso(parseLegacyDate("6.20.", 2025).date), "2025-06-20");
});

test("日期范围不会被强行塞进某一天", () => {
  const result = parseLegacyDate("5.9-14", 2025);
  assert.equal(result.date, null);
  assert.equal(result.candidateRange, "2025-05-09 至 2025-05-14");
  assert.match(result.reason, /日期范围/);
});

test("相邻两天之间的空白日期继承上一天", () => {
  const previous = parseLegacyDate("2026.6.5").date;
  const next = parseLegacyDate("2026.6.6").date;
  const result = inferBlankDate(previous, next);
  assert.equal(dateToIso(result.date), "2026-06-05");
  assert.equal(result.quality, "继承上一日期");
});

test("跨度较大的相邻日期只生成候选范围", () => {
  const previous = parseLegacyDate("2026.6.5").date;
  const next = parseLegacyDate("2026.6.8").date;
  const result = inferBlankDate(previous, next);
  assert.equal(result.date, null);
  assert.equal(result.candidateRange, "2026-06-05 至 2026-06-08");
});

test("Excel 日期序号会转换成真实日期对象", () => {
  const result = parseLegacyDate(45979);
  assert.ok(result.date instanceof Date);
  assert.equal(result.quality, "Excel序号");
});

test("特殊交易不会误算成普通收入或支出", () => {
  assert.equal(classifyTransaction("红转周", "流出"), "内部转账");
  assert.equal(classifyTransaction("购汇美元1万", "流出"), "换汇");
  assert.equal(classifyTransaction("上余", "流入"), "期初余额");
});

test("常见说明能得到可读分类", () => {
  assert.equal(classifyCategory("上海公司会计费"), "税费");
  assert.equal(classifyCategory("快递和布运费"), "物流运输");
});

test("重复记录只标记待确认，不自动删除", () => {
  const dateInfo = parseLegacyDate("2026.8.22");
  const base = {
    groupId: "G1",
    dateInfo,
    person: "周",
    account: "人民币账户",
    type: "支出",
    direction: "流出",
    amount: 100,
    currency: "CNY",
    category: "未分类",
    originalDescription: "测试支出",
  };
  const records = [
    createRecord({ ...base, recordId: "R1" }),
    createRecord({ ...base, recordId: "R2" }),
  ];
  markDuplicates(records);
  assert.equal(records.length, 2);
  assert.equal(records[1]["数据状态"], "待确认");
  assert.match(records[1]["异常原因"], /疑似重复/);
});

test("正负金额直接表达资金方向", () => {
  const expense = createRecord({
    recordId: "R3", groupId: "G3", dateInfo: parseLegacyDate("2026.8.22"),
    person: "周", account: "人民币账户", type: "支出", direction: "流出",
    amount: 20, currency: "CNY", category: "未分类",
  });
  assert.equal(signedAmount(expense), -20);
});

test("异常描述会按数字、标点和空格拆成可点击分词", () => {
  assert.deepEqual(tokenizeDescription("水电充值250，停车 吃饭425"), ["水电充值", "250", "停车", "吃饭", "425"]);
});

test("异常拆分行会按金额自动匹配各自的备注片段", () => {
  const shared = {
    dateInfo: parseLegacyDate("2026.8.25"), groupId: "NOTE-GROUP", account: "人民币账户",
    currency: "CNY", category: "未分类", status: "待确认", originalDescription: "菜150，收布碎77",
  };
  const expense = createRecord({ ...shared, recordId: "NOTE-OUT", person: "周", type: "调整", direction: "流出", amount: 150 });
  const income = createRecord({ ...shared, recordId: "NOTE-IN", person: "红", type: "调整", direction: "流入", amount: 77 });
  assert.equal(inferTransactionNote(expense), "菜150");
  assert.equal(inferTransactionNote(income), "收布碎77");
  assert.deepEqual(buildReviewGroups([expense, income])[0].rows.map((row) => row.note), ["菜150", "收布碎77"]);
});

test("网页确认可以把一条异常拆成多笔正负金额", () => {
  const original = createRecord({
    recordId: "R4", groupId: "G4", dateInfo: { date: null, reason: "缺少日期" },
    person: "红", account: "人民币账户", type: "调整", direction: "流入",
    amount: 80, currency: "CNY", category: "未分类", status: "待确认",
    originalDescription: "收废料100，买水20",
  });
  const result = applyReviewResolutions([original], [{
    groupId: "G4",
    action: "confirm",
    rows: [
      { date: "2026-08-22", person: "红", amount: 100, transactionType: "", category: "", note: "收废料" },
      { date: "2026-08-22", person: "红", amount: -20, transactionType: "", category: "", note: "买水" },
    ],
  }]);
  assert.equal(result.length, 2);
  assert.equal(result[0]["交易类型"], "收入");
  assert.equal(result[1]["交易类型"], "支出");
  assert.equal(result.every((record) => record["数据状态"] === "有效"), true);
});

test("服务端允许无日期记录，但仍拒绝没有拆分行的异常确认", () => {
  const original = createRecord({
    recordId: "R5", groupId: "G5", dateInfo: { date: null, reason: "缺少日期" },
    person: "红", account: "人民币账户", type: "调整", direction: "流出",
    amount: 20, currency: "CNY", category: "未分类", status: "待确认",
  });
  assert.throws(() => applyReviewResolutions([original], [{
    groupId: "G5", action: "confirm", rows: [],
  }]), /至少需要一行/);
  const undated = applyReviewResolutions([original], [{
    groupId: "G5", action: "confirm",
    rows: [{ date: "", person: "红", amount: -20 }],
  }]);
  assert.equal(reportingDateForRecord(undated[0]), null);
  assert.equal(reviewPriorityForRecord(undated[0]), "低");
  assert.equal(isRecordIncludedInReport(undated[0]), true);
});

test("异常组会提供完整原始人员信息和可调整的预估日期", () => {
  const shared = {
    groupId: "G6",
    dateInfo: {
      date: null,
      candidateRange: "2026-06-05 至 2026-06-08",
      reason: "日期只能确定范围",
    },
    account: "人民币账户",
    type: "调整",
    amount: 20,
    currency: "CNY",
    category: "未分类",
    status: "待确认",
    originalDate: "6.5-6.8",
    originalDescription: "周收20，叶付20",
    sourceSheet: "厂收支明细",
    sourceCell: "C46",
  };
  const records = [
    createRecord({ ...shared, recordId: "R6-IN", person: "周", direction: "流入" }),
    createRecord({ ...shared, recordId: "R6-OUT", person: "叶", direction: "流出" }),
  ];
  const [group] = buildReviewGroups(records);
  assert.equal(group.originalIncomePeople, "周（+20）");
  assert.equal(group.originalExpensePeople, "叶（-20）");
  assert.equal(group.estimatedDate, "2026-06-05");
  assert.equal(group.rows.every((row) => row.estimatedDate === "2026-06-05"), true);
});

test("三种处理决定可以反复切换并正确划分待处理与已处理区域", () => {
  const source = createRecord({
    recordId: "R7", groupId: "G7", dateInfo: { date: null, reason: "缺少日期" },
    person: "周", account: "人民币账户", type: "支出", direction: "流出",
    amount: 30, currency: "CNY", category: "未分类", status: "待确认",
    originalDescription: "饭费30",
  });
  const confirmed = {
    groupId: "G7",
    action: "confirm",
    rows: [{ date: "2026-08-24", person: "周", amount: -30, transactionType: "支出" }],
  };
  const confirmedRecords = applyReviewResolutions([source], [confirmed]);
  assert.equal(confirmedRecords[0]["数据状态"], "有效");

  const decisions = mergeReviewDecisions([confirmed], [{ ...confirmed, action: "defer" }]);
  const deferredRecords = applyReviewResolutions([source], decisions);
  assert.equal(deferredRecords[0]["数据状态"], "待确认");
  assert.notEqual(deferredRecords[0], source, "重新计算不能修改不可变原始记录");

  const collections = buildReviewCollections({
    sourceRecords: [source],
    records: deferredRecords,
    reviewDecisions: decisions,
  });
  assert.equal(collections.reviewGroups.length, 0);
  assert.equal(collections.processedGroups.length, 1);
  assert.equal(collections.processedGroups[0].action, "defer");
});

test("确认纳入时会拒绝交易类型与金额正负号冲突", () => {
  const source = createRecord({
    recordId: "R8", groupId: "G8", dateInfo: { date: null, reason: "缺少日期" },
    person: "红", account: "人民币账户", type: "支出", direction: "流出",
    amount: 20, currency: "CNY", category: "未分类", status: "待确认",
  });
  assert.throws(() => applyReviewResolutions([source], [{
    groupId: "G8",
    action: "confirm",
    rows: [{ date: "2026-08-24", person: "红", amount: 20, transactionType: "支出" }],
  }]), /正负号不一致/);
});

test("只有日期候选范围不确定时属于低优先级并按预估日期计入", () => {
  const record = createRecord({
    recordId: "R9", groupId: "G9",
    dateInfo: {
      date: null,
      candidateRange: "2026-05-27 至 2026-05-29",
      reason: "只能根据上下单元格确定范围：2026-05-27 至 2026-05-29",
    },
    person: "叶", account: "人民币账户", type: "支出", direction: "流出",
    amount: 15, currency: "CNY", category: "物流运输", status: "待确认",
  });
  assert.equal(reviewPriorityForRecord(record), "低");
  assert.equal(dateToIso(reportingDateForRecord(record)), "2026-05-27");
  assert.equal(isRecordIncludedInReport(record), true);
});

test("完全没有日期但其他统计字段可靠时属于低优先级并计入无日期区块", () => {
  const record = createRecord({
    recordId: "R9-NO-DATE", groupId: "G9-NO-DATE",
    dateInfo: { date: null, reason: "无法通过上下日期单元格确定日期" },
    person: "周", account: "人民币账户", type: "支出", direction: "流出",
    amount: 30, currency: "CNY", category: "餐饮", status: "待确认",
  });
  assert.equal(reviewPriorityForRecord(record), "低");
  assert.equal(reportingDateForRecord(record), null);
  assert.equal(isRecordIncludedInReport(record), true);
  assert.match(buildReviewGroups([record])[0].priorityMessage, /无日期区块/);
});

test("缺少统计字段或存在非日期异常时属于高优先级且不计入", () => {
  const record = createRecord({
    recordId: "R10", groupId: "G10",
    dateInfo: {
      date: null,
      candidateRange: "2026-05-27 至 2026-05-29",
      reason: "只能根据上下单元格确定范围：2026-05-27 至 2026-05-29",
    },
    person: "", account: "人民币账户", type: "支出", direction: "流出",
    amount: 15, currency: "CNY", category: "物流运输", status: "待确认",
    exceptionReason: "归属人员不明确",
  });
  assert.equal(reviewPriorityForRecord(record), "高");
  assert.equal(reportingDateForRecord(record), null);
  assert.equal(isRecordIncludedInReport(record), false);
});

test("待处理异常组始终把高优先级排在低优先级前面", () => {
  const low = createRecord({
    recordId: "R11", groupId: "G11",
    dateInfo: {
      date: null,
      candidateRange: "2026-06-05 至 2026-06-08",
      reason: "只能根据上下单元格确定范围：2026-06-05 至 2026-06-08",
    },
    person: "周", account: "人民币账户", type: "支出", direction: "流出",
    amount: 20, currency: "CNY", category: "未分类", status: "待确认",
  });
  const high = createRecord({
    recordId: "R12", groupId: "G12", dateInfo: { date: null, reason: "缺少日期" },
    person: "", account: "人民币账户", type: "支出", direction: "流出",
    amount: 30, currency: "CNY", category: "未分类", status: "待确认",
  });
  const groups = buildReviewGroups([low, high]);
  assert.deepEqual(groups.map((group) => group.priority), ["高", "低"]);
});

test("异常处理历史只恢复原始内容完全相同的记录", async () => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "bookkeeping-history-test-"));
  const historyPath = path.join(temporaryDir, "异常处理进度.json");
  const samplesPath = path.join(temporaryDir, "规则改进样本.json");
  const source = createRecord({
    recordId: "H1", groupId: "H-GROUP", dateInfo: { date: null, reason: "日期待确认" },
    person: "周", account: "人民币账户", type: "支出", direction: "流出",
    amount: 30, currency: "CNY", category: "餐饮", status: "待确认",
    originalDescription: "饭费30", sourceSheet: "厂收支明细", sourceCell: "C20",
  });
  const decision = {
    groupId: "H-GROUP", action: "confirm",
    rows: [{ date: "2026-08-24", person: "周", amount: -30, transactionType: "支出", category: "餐饮", note: "饭费30" }],
  };

  try {
    await recordReviewDecisions({ sourceRecords: [source], decisions: [decision], historyPath, samplesPath });
    const history = JSON.parse(await fs.readFile(historyPath, "utf8"));
    assert.equal(restoreReviewDecisions([source], history)[0].rows[0].amount, -30);
    assert.equal(history.entries[0].fingerprint, reviewGroupFingerprint(buildReviewGroups([source])[0]));

    const changed = { ...source, "原始描述": "饭费35" };
    assert.deepEqual(restoreReviewDecisions([changed], history), []);
  } finally {
    await fs.rm(temporaryDir, { recursive: true, force: true });
  }
});

test("规则改进样本排除暂不处理，并且不保存普通流水", () => {
  const samples = buildRuleImprovementSamples({
    schemaVersion: 1,
    updatedAt: "2026-08-24T00:00:00.000Z",
    entries: [
      { fingerprint: "A", source: { originalDescription: "确认样本" }, action: "confirm", rows: [{ amount: 10 }], savedAt: "T", ruleVersion: "R" },
      { fingerprint: "B", source: { originalDescription: "稍后再说" }, action: "defer", rows: [{ amount: 20 }], savedAt: "T", ruleVersion: "R" },
      { fingerprint: "C", source: { originalDescription: "不是流水" }, action: "ignore", savedAt: "T", ruleVersion: "R" },
    ],
  });
  assert.equal(samples.sampleCount, 2);
  assert.deepEqual(samples.samples.map((sample) => sample.decision), ["confirm", "ignore"]);
  assert.equal(samples.samples[1].trueValue, null);
  assert.equal("normalRecords" in samples, false);
});
