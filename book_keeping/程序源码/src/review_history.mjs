import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildReviewGroups, mergeReviewDecisions } from "./review.mjs";

export const REVIEW_HISTORY_SCHEMA_VERSION = 1;
export const REVIEW_RULE_VERSION = "2026.08.24-1";

function emptyHistory() {
  return {
    schemaVersion: REVIEW_HISTORY_SCHEMA_VERSION,
    updatedAt: "",
    entries: [],
  };
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanRows(rows = []) {
  return rows.map((row) => ({
    date: cleanText(row.date),
    person: cleanText(row.person),
    amount: Number(row.amount),
    transactionType: cleanText(row.transactionType),
    category: cleanText(row.category),
    note: cleanText(row.note),
    currency: cleanText(row.currency) || "CNY",
    account: cleanText(row.account),
  }));
}

/**
 * 用异常的原始内容生成稳定指纹，而不是直接使用交易组 ID。
 * 交易组 ID 可能在导入规则升级后变化；原工作表、单元格和原文完全一致时，
 * 才能安全恢复旧答案。只要原始内容变化，指纹就会变化，避免误套历史结果。
 */
export function reviewGroupFingerprint(group) {
  const identity = {
    sourceSheet: cleanText(group.sourceSheet),
    sourceCell: cleanText(group.sourceCell),
    originalDate: cleanText(group.originalDate),
    originalDescription: cleanText(group.originalDescription),
    originalIncomePeople: cleanText(group.originalIncomePeople),
    originalExpensePeople: cleanText(group.originalExpensePeople),
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function sourceSnapshot(group) {
  return {
    sourceSheet: cleanText(group.sourceSheet),
    sourceCell: cleanText(group.sourceCell),
    originalDate: cleanText(group.originalDate),
    originalDescription: cleanText(group.originalDescription),
    originalIncomePeople: cleanText(group.originalIncomePeople),
    originalExpensePeople: cleanText(group.originalExpensePeople),
    exceptionReason: cleanText(group.exceptionReason),
    candidateDateRange: cleanText(group.candidateDateRange),
  };
}

function historyEntry(group, decision, savedAt) {
  const entry = {
    fingerprint: reviewGroupFingerprint(group),
    source: sourceSnapshot(group),
    action: decision.action,
    savedAt,
    ruleVersion: REVIEW_RULE_VERSION,
  };

  // “忽略”只需要保留决定和原文。确认、暂不处理则保留编辑行：前者是
  // 可用于改进规则的 true value，后者让用户下次继续时不用重新填写半成品。
  if (decision.action !== "ignore") entry.rows = cleanRows(decision.rows ?? group.rows);
  return entry;
}

export async function loadReviewHistory(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (parsed.schemaVersion !== REVIEW_HISTORY_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
      throw new Error("异常处理进度文件版本不受支持");
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return emptyHistory();
    throw error;
  }
}

async function writeJsonAtomically(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  // 先完整写临时文件再替换，可以避免电脑突然关机时留下半截 JSON。
  await fs.rename(temporaryPath, filePath);
}

export function buildRuleImprovementSamples(history) {
  const samples = history.entries
    .filter((entry) => ["confirm", "ignore"].includes(entry.action))
    .map((entry) => ({
      fingerprint: entry.fingerprint,
      source: entry.source,
      decision: entry.action,
      decisionLabel: entry.action === "confirm" ? "确认并纳入" : "忽略",
      // 忽略表示这条原文不应成为交易，因此没有拆分后的 true value 行。
      trueValue: entry.action === "confirm" ? (entry.rows ?? []) : null,
      savedAt: entry.savedAt,
      ruleVersion: entry.ruleVersion,
    }));
  return {
    schemaVersion: REVIEW_HISTORY_SCHEMA_VERSION,
    purpose: "用于根据用户确认的 true value 改进记账导入规则",
    privacyNote: "只包含异常原文、必要定位信息和用户确认结果，不包含普通流水或整份工作簿。",
    exportedAt: new Date().toISOString(),
    sampleCount: samples.length,
    samples,
  };
}

export async function saveReviewHistoryFiles({ historyPath, samplesPath, history }) {
  await writeJsonAtomically(historyPath, history);
  await writeJsonAtomically(samplesPath, buildRuleImprovementSamples(history));
}

export async function recordReviewDecisions({
  sourceRecords,
  decisions,
  historyPath,
  samplesPath,
  now = new Date(),
}) {
  const groupsById = new Map(buildReviewGroups(sourceRecords).map((group) => [group.groupId, group]));
  const history = await loadReviewHistory(historyPath);
  const entriesByFingerprint = new Map(history.entries.map((entry) => [entry.fingerprint, entry]));
  const savedAt = now.toISOString();
  let savedCount = 0;

  for (const decision of mergeReviewDecisions([], decisions)) {
    const group = groupsById.get(decision.groupId);
    if (!group) continue;
    const entry = historyEntry(group, decision, savedAt);
    entriesByFingerprint.set(entry.fingerprint, entry);
    savedCount += 1;
  }

  const nextHistory = {
    schemaVersion: REVIEW_HISTORY_SCHEMA_VERSION,
    updatedAt: savedAt,
    entries: [...entriesByFingerprint.values()].sort((left, right) =>
      `${left.source.sourceSheet}:${left.source.sourceCell}`.localeCompare(
        `${right.source.sourceSheet}:${right.source.sourceCell}`,
        "zh-CN",
      )),
  };
  await saveReviewHistoryFiles({ historyPath, samplesPath, history: nextHistory });
  return {
    savedAt,
    savedCount,
    progressCount: nextHistory.entries.length,
    sampleCount: buildRuleImprovementSamples(nextHistory).sampleCount,
  };
}

export function restoreReviewDecisions(sourceRecords, history) {
  const entriesByFingerprint = new Map(history.entries.map((entry) => [entry.fingerprint, entry]));
  const restored = [];

  for (const group of buildReviewGroups(sourceRecords)) {
    const entry = entriesByFingerprint.get(reviewGroupFingerprint(group));
    if (!entry || !["confirm", "defer", "ignore"].includes(entry.action)) continue;
    restored.push({
      groupId: group.groupId,
      action: entry.action,
      rows: entry.action === "ignore" ? group.rows : (entry.rows ?? group.rows),
    });
  }
  return restored;
}
