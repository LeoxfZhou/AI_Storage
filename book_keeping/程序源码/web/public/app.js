const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
const TRANSACTION_TYPES = ["", "收入", "支出", "内部转账", "换汇", "借款", "还款", "期初余额", "调整"];
const REVIEW_ACTIONS = [
  { value: "confirm", label: "确认并纳入" },
  { value: "defer", label: "暂不处理" },
  { value: "ignore", label: "忽略" },
];

const elements = {
  sideNavToggle: document.querySelector("#sideNavToggle"),
  sideNavLinks: [...document.querySelectorAll("#sideNav a")],
  modeButtons: [...document.querySelectorAll(".mode-card")],
  fileHint: document.querySelector("#fileHint"),
  fileInput: document.querySelector("#fileInput"),
  dropZone: document.querySelector("#dropZone"),
  selectedFile: document.querySelector("#selectedFile"),
  selectedName: document.querySelector("#selectedName"),
  selectedSize: document.querySelector("#selectedSize"),
  removeFile: document.querySelector("#removeFile"),
  sheetPicker: document.querySelector("#sheetPicker"),
  sheetOptions: document.querySelector("#sheetOptions"),
  toggleSheetsButton: document.querySelector("#toggleSheetsButton"),
  processButton: document.querySelector("#processButton"),
  processButtonText: document.querySelector("#processButtonText"),
  templateButton: document.querySelector("#templateButton"),
  progressCard: document.querySelector("#progressCard"),
  progressTitle: document.querySelector("#progressTitle"),
  progressDetail: document.querySelector("#progressDetail"),
  resultCard: document.querySelector("#resultCard"),
  summaryGrid: document.querySelector("#summaryGrid"),
  downloadList: document.querySelector("#downloadList"),
  saveFolderButton: document.querySelector("#saveFolderButton"),
  resultNote: document.querySelector("#resultNote"),
  autosaveStatus: document.querySelector("#autosaveStatus"),
  exportSamplesButton: document.querySelector("#exportSamplesButton"),
  startOverButton: document.querySelector("#startOverButton"),
  reviewSection: document.querySelector("#reviewSection"),
  reviewCount: document.querySelector("#reviewCount"),
  reviewList: document.querySelector("#reviewList"),
  processedSection: document.querySelector("#processedSection"),
  processedCount: document.querySelector("#processedCount"),
  processedFilters: document.querySelector("#processedFilters"),
  processedList: document.querySelector("#processedList"),
  saveReviewButton: document.querySelector("#saveReviewButton"),
  errorCard: document.querySelector("#errorCard"),
  errorTitle: document.querySelector("#errorTitle"),
  errorMessage: document.querySelector("#errorMessage"),
  retryButton: document.querySelector("#retryButton"),
};

let selectedModes = new Set(["legacy"]);
let selectedMode = "legacy";
let selectedFile = null;
let inspectedWorkbook = null;
let currentResult = null;
let progressTimer = null;
let reviewAutosaveTimer = null;
let reviewAutosaveSequence = 0;
let activeReviewInput = null;
let processedFilter = "confirm";
let reviewUiState = { pending: [], processed: [] };

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function hideStatusCards() {
  elements.progressCard.classList.add("hidden");
  elements.resultCard.classList.add("hidden");
  elements.reviewSection.classList.add("hidden");
  elements.processedSection.classList.add("hidden");
  elements.errorCard.classList.add("hidden");
}

function updateProcessButton() {
  const selectedSheetCount = elements.sheetOptions.querySelectorAll('input[type="checkbox"]:checked').length;
  const ready = Boolean(inspectedWorkbook) && (
    selectedMode === "standard"
      ? inspectedWorkbook.kind === "standard"
      : inspectedWorkbook.kind === "legacy" && selectedSheetCount > 0
  );
  elements.processButton.disabled = !ready;
  elements.processButtonText.textContent = !inspectedWorkbook
    ? "选择文件后开始"
    : selectedMode === "legacy"
      ? "生成标准化输入数据"
      : selectedMode === "pipeline"
        ? "连续生成标准数据和最终结果"
        : "生成最终记账结果";
}

function renderSheetPicker() {
  elements.sheetOptions.replaceChildren();
  if (!inspectedWorkbook || selectedMode === "standard") {
    elements.sheetPicker.classList.add("hidden");
    updateProcessButton();
    return;
  }

  for (const sheet of inspectedWorkbook.sheets ?? []) {
    const label = document.createElement("label");
    label.className = `sheet-option${sheet.supported ? "" : " unsupported"}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = sheet.name;
    checkbox.checked = Boolean(sheet.selectedByDefault);
    checkbox.disabled = !sheet.supported;
    checkbox.addEventListener("change", updateProcessButton);
    const name = document.createElement("span");
    name.textContent = sheet.name;
    const state = document.createElement("small");
    state.textContent = sheet.supported ? "可导入" : "未配置规则";
    label.append(checkbox, name, state);
    elements.sheetOptions.append(label);
  }
  elements.sheetPicker.classList.remove("hidden");
  updateProcessButton();
}

function setMode(mode) {
  if (selectedModes.has(mode)) {
    // 至少保留一个步骤，避免页面进入“没有任何处理动作”的死状态。
    if (selectedModes.size === 1) return;
    selectedModes.delete(mode);
  } else {
    selectedModes.add(mode);
  }
  selectedMode = selectedModes.size === 2 ? "pipeline" : [...selectedModes][0];
  for (const button of elements.modeButtons) {
    const active = selectedModes.has(button.dataset.mode);
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  }
  elements.fileHint.textContent = selectedMode === "standard"
    ? "请选择程序生成、并经过复核的标准化输入数据 .xlsx。"
    : selectedMode === "pipeline"
      ? "请选择原始历史流水 .xlsx；程序会连续生成标准化数据和最终记账报告。"
      : "请选择原始历史流水 .xlsx；选择后可以多选需要导入的工作表标签。";
  renderSheetPicker();
  hideStatusCards();
}

function clearFile() {
  selectedFile = null;
  inspectedWorkbook = null;
  currentResult = null;
  reviewUiState = { pending: [], processed: [] };
  clearTimeout(reviewAutosaveTimer);
  elements.fileInput.value = "";
  elements.selectedFile.classList.add("hidden");
  elements.dropZone.classList.remove("hidden");
  elements.sheetPicker.classList.add("hidden");
  elements.sheetOptions.replaceChildren();
  hideStatusCards();
  updateProcessButton();
}

function showError(title, message) {
  clearInterval(progressTimer);
  elements.progressCard.classList.add("hidden");
  elements.errorTitle.textContent = title;
  elements.errorMessage.textContent = message;
  elements.errorCard.classList.remove("hidden");
  updateProcessButton();
}

function startProgress(title, detail) {
  elements.errorCard.classList.add("hidden");
  elements.resultCard.classList.add("hidden");
  elements.reviewSection.classList.add("hidden");
  elements.processedSection.classList.add("hidden");
  elements.progressTitle.textContent = title;
  elements.progressDetail.textContent = detail;
  elements.progressCard.classList.remove("hidden");
  elements.processButton.disabled = true;
}

async function readJsonResponse(response) {
  const payload = await response.json().catch(() => ({ message: "服务返回了无法识别的结果" }));
  if (!response.ok || !payload.ok) throw new Error(payload.details || payload.message || "处理失败");
  return payload;
}

async function inspectSelectedFile(file) {
  startProgress("正在读取工作表标签…", "程序只读取结构，不会修改原文件。");
  const response = await fetch("/api/inspect", {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  inspectedWorkbook = await readJsonResponse(response);
  elements.progressCard.classList.add("hidden");
  renderSheetPicker();

  if (selectedMode === "standard" && inspectedWorkbook.kind !== "standard") {
    showError("这不像标准输入文件", "没有找到“填写说明”和“标准流水”工作表。你仍可切换到第①步处理原始数据。");
  }
}

async function chooseFile(file) {
  hideStatusCards();
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    showError("文件格式不对", "请选择扩展名为 .xlsx 的 Excel 文件。");
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showError("文件太大", "文件不能超过 80 MB，请先精简后再处理。");
    return;
  }

  selectedFile = file;
  elements.selectedName.textContent = file.name;
  elements.selectedSize.textContent = formatBytes(file.size);
  elements.dropZone.classList.add("hidden");
  elements.selectedFile.classList.remove("hidden");
  try {
    await inspectSelectedFile(file);
  } catch (error) {
    inspectedWorkbook = null;
    showError("无法读取工作簿", error.message);
  }
}

function beginProcessingProgress() {
  const stages = selectedMode === "legacy"
    ? ["正在读取选中的工作表…", "正在推断相邻日期…", "正在整理标准数据…", "正在准备异常复核…"]
    : selectedMode === "pipeline"
      ? ["正在标准化原始流水…", "正在判断异常优先级…", "正在生成最终记账报告…", "正在准备两份下载文件…"]
      : ["正在读取标准流水…", "正在生成简洁流水…", "正在计算每日、月度和年度汇总…"];
  let stageIndex = 0;
  startProgress(stages[0], "请保持这个页面打开；大工作簿在普通电脑上可能需要 1–3 分钟。");
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    stageIndex = Math.min(stageIndex + 1, stages.length - 1);
    elements.progressTitle.textContent = stages[stageIndex];
  }, 2600);
}

function selectedSheets() {
  return [...elements.sheetOptions.querySelectorAll('input[type="checkbox"]:checked')]
    .map((checkbox) => checkbox.value);
}

function summaryPill(label, value) {
  const pill = document.createElement("span");
  pill.className = "summary-pill";
  pill.innerHTML = `${label} <strong>${Number(value ?? 0).toLocaleString("zh-CN")}</strong>`;
  return pill;
}

function createDownloadButton(file) {
  const link = document.createElement("a");
  link.className = "download-button";
  link.href = file.url;
  link.innerHTML = `<span>${file.name}</span><span>下载到 Downloads ↓</span>`;
  return link;
}

function createTransactionTypeSelect(value = "") {
  const select = document.createElement("select");
  select.className = "review-input type-input";
  for (const type of TRANSACTION_TYPES) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type || "自动判断";
    option.selected = type === value;
    select.append(option);
  }
  return select;
}

function createTextInput(className, value = "", placeholder = "") {
  const input = document.createElement("input");
  input.className = `review-input ${className}`;
  input.value = value ?? "";
  input.placeholder = placeholder;
  input.addEventListener("focus", () => { activeReviewInput = input; });
  return input;
}

function createDateInput(value = "") {
  const input = document.createElement("input");
  input.type = "date";
  input.className = "review-input date-input";
  input.value = value || "";
  input.addEventListener("focus", () => { activeReviewInput = input; });
  return input;
}

function appendReviewRow(tbody, rowData = {}, estimatedDate = "") {
  const row = document.createElement("tr");
  // 日期异常优先显示程序根据上下文推测的日期。date 输入框会提供原生
  // 日历控件，用户仍能在确认前改成候选范围内的其他日期。
  const dateInput = createDateInput(rowData.date || rowData.estimatedDate || estimatedDate);
  const personInput = createTextInput("person-input", rowData.person, "人员");
  const amountInput = createTextInput("amount-input", rowData.amount ?? "", "+20 或 -20");
  const typeSelect = createTransactionTypeSelect(rowData.transactionType);
  const categoryInput = createTextInput("category-input", rowData.category, "可不填");
  categoryInput.setAttribute("list", "categoryOptions");
  const noteInput = createTextInput("note-input", rowData.note, "备注");
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "row-delete";
  deleteButton.textContent = "×";
  deleteButton.title = "删除这一拆分行";
  deleteButton.addEventListener("click", () => row.remove());

  amountInput.addEventListener("input", () => {
    const amount = Number(amountInput.value);
    if (Number.isFinite(amount) && amount !== 0 && ["", "收入", "支出"].includes(typeSelect.value)) {
      typeSelect.value = amount > 0 ? "收入" : "支出";
    }
  });

  for (const control of [dateInput, personInput, amountInput, typeSelect, categoryInput, noteInput, deleteButton]) {
    const cell = document.createElement("td");
    cell.append(control);
    row.append(cell);
  }
  row.dataset.currency = rowData.currency || "CNY";
  row.dataset.account = rowData.account || "未指定账户";
  tbody.append(row);
}

function appendOriginalDataTable(article, group) {
  const block = document.createElement("div");
  block.className = "original-data-block";
  const table = document.createElement("table");
  table.className = "original-data-table";
  table.innerHTML = "<thead><tr><th>原始日期</th><th>原始收支明目</th><th>原始收入人</th><th>原始支出人</th></tr></thead>";
  const row = document.createElement("tr");
  for (const value of [
    group.originalDate || "空",
    group.originalDescription || "空",
    group.originalIncomePeople || "空",
    group.originalExpensePeople || "空",
  ]) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.append(cell);
  }
  const tbody = document.createElement("tbody");
  tbody.append(row);
  table.append(tbody);
  block.append(table);

  if (group.candidateDateRange) {
    const candidate = document.createElement("p");
    candidate.className = "candidate-date";
    candidate.textContent = `候选日期：${group.candidateDateRange}`;
    block.append(candidate);
  }
  article.append(block);
}

function createActionButtons(group, location) {
  const controls = document.createElement("div");
  controls.className = "review-action-buttons";
  for (const option of REVIEW_ACTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `review-action-button action-${option.value}`;
    button.textContent = option.label;
    button.classList.toggle("active", location === "processed" && group.action === option.value);
    button.setAttribute("aria-pressed", String(location === "processed" && group.action === option.value));
    button.addEventListener("click", () => { void changeReviewAction(group.groupId, option.value, location); });
    controls.append(button);
  }
  return controls;
}

function createReviewCard(group, location) {
  const article = document.createElement("article");
  article.className = `review-card priority-${group.priority === "低" ? "low" : "high"}`;
  article.dataset.groupId = group.groupId;

  const header = document.createElement("div");
  header.className = "review-card-header";
  const headerCopy = document.createElement("div");
  const sourceTitle = document.createElement("strong");
  sourceTitle.textContent = `${group.sourceSheet || "未知来源"} · ${group.sourceCell || ""}`;
  const priorityBadge = document.createElement("span");
  priorityBadge.className = "priority-badge";
  priorityBadge.textContent = `${group.priority === "低" ? "低" : "高"}优先级`;
  const reason = document.createElement("p");
  reason.textContent = group.exceptionReason || "需要确认";
  const priorityMessage = document.createElement("small");
  priorityMessage.className = "priority-message";
  priorityMessage.textContent = group.priorityMessage || "处理前不计入报表";
  headerCopy.append(sourceTitle, priorityBadge, reason, priorityMessage);
  header.append(headerCopy, createActionButtons(group, location));
  article.append(header);

  appendOriginalDataTable(article, group);

  const tokens = document.createElement("div");
  tokens.className = "token-list";
  const tokenLabel = document.createElement("span");
  tokenLabel.textContent = "分词：";
  tokens.append(tokenLabel);
  for (const token of group.tokens ?? []) {
    const tokenButton = document.createElement("button");
    tokenButton.type = "button";
    tokenButton.className = "token-button";
    tokenButton.textContent = token;
    tokenButton.addEventListener("click", () => {
      if (!activeReviewInput || !article.contains(activeReviewInput)) return;
      const start = activeReviewInput.selectionStart ?? activeReviewInput.value.length;
      const end = activeReviewInput.selectionEnd ?? start;
      const spacer = start > 0 && !/\s$/.test(activeReviewInput.value.slice(0, start)) ? " " : "";
      activeReviewInput.value = `${activeReviewInput.value.slice(0, start)}${spacer}${token}${activeReviewInput.value.slice(end)}`;
      activeReviewInput.dispatchEvent(new Event("input", { bubbles: true }));
      activeReviewInput.focus();
    });
    tokens.append(tokenButton);
  }
  article.append(tokens);

  const tableWrap = document.createElement("div");
  tableWrap.className = "review-table-wrap";
  const table = document.createElement("table");
  table.className = "review-table";
  table.innerHTML = "<thead><tr><th>日期</th><th>人员</th><th>金额</th><th>交易类型</th><th>分类（可选）</th><th>备注</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const rowData of group.rows?.length ? group.rows : [{}]) appendReviewRow(tbody, rowData, group.estimatedDate);
  table.append(tbody);
  tableWrap.append(table);
  article.append(tableWrap);

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "add-row-button";
  addButton.textContent = "+ 增加一笔收入或支出";
  addButton.addEventListener("click", () => {
    const first = group.rows?.[0] ?? {};
    appendReviewRow(tbody, {
      date: first.date || first.estimatedDate || group.estimatedDate,
      person: first.person,
      currency: first.currency,
      account: first.account,
      amount: "",
      transactionType: "",
      category: "",
      note: "",
    }, group.estimatedDate);
  });
  article.append(addButton);
  if (location === "processed") {
    // 已处理卡片仍允许继续修改。输入变化后延迟自动保存，既避免每敲一个字
    // 都发送请求，也确保用户切换页面或稍后关闭程序时能恢复最新编辑内容。
    article.addEventListener("input", () => scheduleReviewAutosave());
    article.addEventListener("change", () => scheduleReviewAutosave());
  }
  return article;
}

function collectRowsFromCard(card) {
  // 卡片里同时有“原始数据表”和“可编辑结果表”。只读取 .review-table，
  // 否则原始表那一行没有输入框，会在点击三个处理按钮时产生空值错误。
  return [...card.querySelectorAll(".review-table tbody tr")].map((row) => ({
    date: row.querySelector(".date-input").value,
    person: row.querySelector(".person-input").value.trim(),
    amount: row.querySelector(".amount-input").value.trim(),
    transactionType: row.querySelector(".type-input").value,
    category: row.querySelector(".category-input").value.trim(),
    note: row.querySelector(".note-input").value.trim(),
    currency: row.dataset.currency,
    account: row.dataset.account,
  }));
}

function validateConfirmedRows(rows) {
  if (rows.length === 0) throw new Error("确认纳入的异常至少需要保留一行");
  const invalid = rows.find((row) => (row.date && !/^\d{4}-\d{2}-\d{2}$/.test(row.date))
    || !row.person || !Number.isFinite(Number(row.amount)) || Number(row.amount) === 0);
  if (invalid) throw new Error("确认纳入时，每一行都需要人员和非零正负金额；日期可以留空，但填写时必须完整");

  const mismatch = rows.find((row) => (row.transactionType === "收入" && Number(row.amount) < 0)
    || (row.transactionType === "支出" && Number(row.amount) > 0));
  if (mismatch) throw new Error("金额为正时应是收入，金额为负时应是支出；也可以把交易类型留给程序自动判断");
}

function syncRenderedCards(container, groups) {
  const groupsById = new Map(groups.map((group) => [group.groupId, group]));
  for (const card of container.querySelectorAll(".review-card")) {
    const group = groupsById.get(card.dataset.groupId);
    if (group) group.rows = collectRowsFromCard(card);
  }
}

function currentResolutions() {
  return reviewUiState.processed.map((group) => ({
    groupId: group.groupId,
    action: group.action,
    rows: group.rows ?? [],
  }));
}

function showAutosaveStatus(message, state = "") {
  elements.autosaveStatus.textContent = message;
  elements.autosaveStatus.dataset.state = state;
}

async function autosaveReviewProgress() {
  if (!currentResult?.jobId || reviewUiState.processed.length === 0) return;
  try {
    syncRenderedCards(elements.processedList, reviewUiState.processed);
    const resolutions = currentResolutions();
    for (const group of reviewUiState.processed.filter((item) => item.action === "confirm")) {
      validateConfirmedRows(group.rows ?? []);
    }

    const sequence = ++reviewAutosaveSequence;
    showAutosaveStatus("正在把异常处理进度保存到本机…", "saving");
    const response = await fetch("/api/review/autosave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: currentResult.jobId, resolutions }),
    });
    const saved = await readJsonResponse(response);
    // 如果用户连续修改，较早请求可能最后才返回。序号校验可防止旧状态覆盖
    // 新提示，让页面错误地显示较早一次保存的计数。
    if (sequence !== reviewAutosaveSequence) return;
    const time = new Date(saved.savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    showAutosaveStatus(
      `异常处理进度已自动保存（${saved.progressCount} 组，规则样本 ${saved.sampleCount} 组，${time}）`,
      "saved",
    );
  } catch (error) {
    showAutosaveStatus(`自动保存失败：${error.message}。请点击“保存所有修改并更新 Excel”重试。`, "error");
  }
}

function scheduleReviewAutosave(delay = 700) {
  clearTimeout(reviewAutosaveTimer);
  reviewAutosaveTimer = setTimeout(() => { void autosaveReviewProgress(); }, delay);
}

async function animateCardRemoval(card) {
  if (!card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // 先锁定当前高度，再在下一帧收缩到 0。若直接删除节点，下面的卡片会瞬移；
  // 让高度参与过渡后，后续卡片会随着网格自然上移，用户能清楚感知已进入下一条。
  card.style.maxHeight = `${card.scrollHeight}px`;
  card.style.pointerEvents = "none";
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  card.classList.add("is-leaving");
  await new Promise((resolve) => setTimeout(resolve, 230));
}

async function changeReviewAction(groupId, action, location) {
  try {
    // 重新渲染会销毁 DOM，因此先把屏幕上其他卡片尚未保存的编辑同步到内存。
    // 否则用户处理第二张卡片时，第一张卡片的文字修改可能悄悄丢失。
    syncRenderedCards(elements.reviewList, reviewUiState.pending);
    syncRenderedCards(elements.processedList, reviewUiState.processed);

    const source = location === "pending" ? reviewUiState.pending : reviewUiState.processed;
    const group = source.find((item) => item.groupId === groupId);
    if (!group) return;
    if (action === "confirm") validateConfirmedRows(group.rows ?? []);
    const card = location === "pending"
      ? elements.reviewList.querySelector(`.review-card[data-group-id="${CSS.escape(groupId)}"]`)
      : null;
    if (card) await animateCardRemoval(card);
    group.action = action;

    if (location === "pending") {
      reviewUiState.pending = reviewUiState.pending.filter((item) => item.groupId !== groupId);
      reviewUiState.processed.push(group);
    }
    // 处理后自动切到刚选择的分类，让用户立刻在“已处理数据”中看到刚移动的
    // 卡片；若仍停留在空的默认分类，会让人误以为数据没有保存到该区域。
    processedFilter = action;
    activeReviewInput = null;
    elements.errorCard.classList.add("hidden");
    renderReviewWorkspace();
    scheduleReviewAutosave(0);
  } catch (error) {
    showError("这组异常还不能确认", error.message);
  }
}

function renderPendingGroups() {
  elements.reviewList.replaceChildren();
  const highCount = reviewUiState.pending.filter((group) => group.priority !== "低").length;
  const lowCount = reviewUiState.pending.length - highCount;
  elements.reviewCount.textContent = `${highCount} 组高优先级 · ${lowCount} 组低优先级`;
  if (selectedMode === "standard" || reviewUiState.pending.length === 0) {
    elements.reviewSection.classList.add("hidden");
    return;
  }
  for (const group of reviewUiState.pending) elements.reviewList.append(createReviewCard(group, "pending"));
  elements.reviewSection.classList.remove("hidden");
}

function renderProcessedGroups() {
  elements.processedFilters.replaceChildren();
  elements.processedList.replaceChildren();
  elements.processedCount.textContent = `${reviewUiState.processed.length} 组已处理`;

  if (selectedMode === "standard" || reviewUiState.processed.length === 0) {
    elements.processedSection.classList.add("hidden");
    return;
  }

  for (const option of REVIEW_ACTIONS) {
    const count = reviewUiState.processed.filter((group) => group.action === option.value).length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "processed-filter-button";
    button.classList.toggle("active", processedFilter === option.value);
    button.textContent = `${option.label} ${count}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(processedFilter === option.value));
    button.addEventListener("click", () => {
      syncRenderedCards(elements.processedList, reviewUiState.processed);
      processedFilter = option.value;
      renderProcessedGroups();
    });
    elements.processedFilters.append(button);
  }

  const visible = reviewUiState.processed.filter((group) => group.action === processedFilter);
  for (const group of visible) elements.processedList.append(createReviewCard(group, "processed"));
  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "processed-empty";
    empty.textContent = "这个分类里暂时没有数据。";
    elements.processedList.append(empty);
  }
  elements.processedSection.classList.remove("hidden");
}

function renderReviewWorkspace() {
  renderPendingGroups();
  renderProcessedGroups();
}

function renderResult(result) {
  clearInterval(progressTimer);
  currentResult = result;
  // 服务端返回的两组数据分别表示“尚未做选择”和“已经做过选择”。复制数组
  // 可以让网页即时移动卡片，而不修改 fetch 返回对象本身，便于后续合并响应。
  reviewUiState = {
    pending: [...(result.reviewGroups ?? [])],
    processed: [...(result.processedGroups ?? [])],
  };
  elements.progressCard.classList.add("hidden");
  elements.errorCard.classList.add("hidden");
  elements.summaryGrid.replaceChildren();
  elements.downloadList.replaceChildren();
  const summary = result.summary ?? {};
  const status = summary.statusCounts ?? {};
  elements.summaryGrid.append(
    summaryPill("流水记录", summary.records),
    summaryPill("有效", status["有效"]),
    summaryPill("待确认", status["待确认"]),
  );
  for (const file of result.files ?? []) elements.downloadList.append(createDownloadButton(file));
  elements.saveFolderButton.classList.toggle("hidden", !(result.files?.length));
  elements.resultNote.textContent = selectedMode === "legacy"
    ? "可以先处理下方异常，再下载更新后的标准化数据。黄色日期异常会按预估日期或无日期区块统计，红色高优先级不会计入。"
    : selectedMode === "pipeline"
      ? "两份文件均可立即下载；处理异常并保存后，标准化数据和最终报告会一起更新。"
      : "最终文件包含“简洁流水”“日汇总”“月汇总”“年汇总”“完整数据”五张工作表。";
  if (result.reviewSavedAt) {
    showAutosaveStatus("异常处理结果已保存，两份 Excel 已重新计算。", "saved");
  } else if ((result.restoredReviewCount ?? 0) > 0) {
    showAutosaveStatus(
      `已从本机恢复 ${result.restoredReviewCount} 组异常处理记录；规则改进样本共 ${result.ruleSampleCount ?? 0} 组。`,
      "saved",
    );
  } else {
    showAutosaveStatus(
      `处理异常后会自动保存进度；当前已有 ${result.savedReviewCount ?? 0} 组本地记录。更新 Excel 仍由下方按钮统一执行。`,
    );
  }
  elements.resultCard.classList.remove("hidden");
  renderReviewWorkspace();
  updateProcessButton();
  elements.resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function processSelectedFile() {
  if (!inspectedWorkbook) return;
  beginProcessingProgress();
  try {
    const response = await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: inspectedWorkbook.jobId,
        mode: selectedMode,
        selectedSheets: selectedMode === "standard" ? [] : selectedSheets(),
      }),
    });
    renderResult(await readJsonResponse(response));
  } catch (error) {
    showError("处理没有完成", error.message);
  }
}

async function saveReviewChanges() {
  try {
    clearTimeout(reviewAutosaveTimer);
    syncRenderedCards(elements.processedList, reviewUiState.processed);
    for (const group of reviewUiState.processed.filter((item) => item.action === "confirm")) {
      validateConfirmedRows(group.rows ?? []);
    }
    const resolutions = currentResolutions();
    if (resolutions.length === 0) {
      showError("还没有已处理数据", "请先在异常卡片上选择“确认并纳入”“暂不处理”或“忽略”。");
      return;
    }
    startProgress(
      "正在保存所有异常处理…",
      selectedMode === "pipeline"
        ? "程序会重新计算，并同时更新标准化输入数据和最终记账报告。"
        : "程序会从原始记录重新计算，并更新标准化输入数据。",
    );
    const response = await fetch("/api/review/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: currentResult.jobId, resolutions }),
    });
    const updated = await readJsonResponse(response);
    renderResult({ ...currentResult, ...updated });
  } catch (error) {
    showError("异常处理没有保存", error.message);
  }
}

async function saveFilesToChosenFolder() {
  if (!currentResult?.files?.length) return;
  if (!("showDirectoryPicker" in window)) {
    showError("当前浏览器不支持选择文件夹", "请使用上面的下载按钮，文件会保存到浏览器默认 Downloads 文件夹。");
    return;
  }
  try {
    const directory = await window.showDirectoryPicker({ mode: "readwrite" });
    for (const file of currentResult.files) {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`无法读取 ${file.name}`);
      const handle = await directory.getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(await response.blob());
      await writable.close();
    }
    elements.saveFolderButton.textContent = "已保存到选择的文件夹 ✓";
  } catch (error) {
    if (error.name !== "AbortError") showError("保存失败", error.message);
  }
}

async function downloadTemplate() {
  const originalContent = elements.templateButton.innerHTML;
  elements.templateButton.disabled = true;
  elements.templateButton.textContent = "正在生成…";
  try {
    const response = await fetch("/api/template", { method: "POST" });
    const result = await readJsonResponse(response);
    window.location.assign(result.files[0].url);
  } catch (error) {
    showError("模板生成失败", error.message);
  } finally {
    elements.templateButton.disabled = false;
    elements.templateButton.innerHTML = originalContent;
  }
}

if (window.innerWidth <= 820) {
  document.body.classList.add("nav-collapsed");
  elements.sideNavToggle.setAttribute("aria-expanded", "false");
  elements.sideNavToggle.setAttribute("aria-label", "展开目录");
}

for (const button of elements.modeButtons) button.addEventListener("click", () => setMode(button.dataset.mode));
elements.sideNavToggle.addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("nav-collapsed");
  elements.sideNavToggle.setAttribute("aria-expanded", String(!collapsed));
  elements.sideNavToggle.setAttribute("aria-label", collapsed ? "展开目录" : "收起目录");
});
for (const link of elements.sideNavLinks) {
  link.addEventListener("click", () => {
    // 小屏幕上跳转后自动收起目录，避免目录挡住异常表格；桌面端保持用户选择。
    if (window.innerWidth <= 820) {
      document.body.classList.add("nav-collapsed");
      elements.sideNavToggle.setAttribute("aria-expanded", "false");
      elements.sideNavToggle.setAttribute("aria-label", "展开目录");
    }
  });
}
elements.dropZone.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => chooseFile(elements.fileInput.files[0]));
elements.removeFile.addEventListener("click", clearFile);
elements.processButton.addEventListener("click", processSelectedFile);
elements.templateButton.addEventListener("click", downloadTemplate);
elements.saveReviewButton.addEventListener("click", saveReviewChanges);
elements.saveFolderButton.addEventListener("click", saveFilesToChosenFolder);
elements.exportSamplesButton.addEventListener("click", () => {
  // 由浏览器正常下载，用户只需把这个小 JSON 文件发给规则维护者，
  // 不必发送包含全部经营流水的原 Excel。
  window.location.assign("/api/review/export-samples");
});
elements.toggleSheetsButton.addEventListener("click", () => {
  const supported = [...elements.sheetOptions.querySelectorAll('input[type="checkbox"]:not(:disabled)')];
  const shouldSelect = supported.some((checkbox) => !checkbox.checked);
  supported.forEach((checkbox) => { checkbox.checked = shouldSelect; });
  updateProcessButton();
});
elements.startOverButton.addEventListener("click", () => {
  clearFile();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
elements.retryButton.addEventListener("click", () => elements.errorCard.classList.add("hidden"));

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
  });
}
elements.dropZone.addEventListener("drop", (event) => chooseFile(event.dataTransfer.files[0]));
