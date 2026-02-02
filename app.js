/**
 * 정산 앱 (의존성 없음)
 * - 입력/저장: 거래 내역 저장
 * - 정산서(행사별): 행사명 단위로 내역 묶고, 추가 입력값(팁/옵션수익/쇼핑수익/기타지출 등) 저장/계산
 * - 수익: 여러 정산서(행사) 합산 + 지출 직접 입력
 * - 저장: localStorage
 */

const STORAGE_KEY = "soo_money_check_entries_v1";
const REPORT_STORAGE_KEY = "soo_money_check_event_reports_v1";
const PROFIT_STORAGE_KEY = "soo_money_check_profit_tab_v1";

/** @typedef {{
 *  id: string,
 *  date: string, // YYYY-MM-DD
 *  client: string,
 *  eventName: string,
 *  eventDetail: string,
 *  income: number,
 *  expense: number,
 *  memo: string,
 *  createdAt: number
 * }} Entry
 */

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element not found: ${id}`);
  return el;
}

function formatNumberKRW(n) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString("ko-KR");
}

function safeTrim(s) {
  return String(s ?? "").trim();
}

function toInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function makeId() {
  // crypto.randomUUID가 없는 환경 대비
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeEventKey(eventName) {
  // 키 충돌/공백/대소문자 문제를 줄이기 위해 정규화된 키 사용
  return safeTrim(eventName).toLowerCase();
}

/** @returns {Entry[]} */
function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(Boolean)
      .map((e) => ({
        id: String(e.id ?? makeId()),
        date: String(e.date ?? ""),
        client: String(e.client ?? ""),
        eventName: String(e.eventName ?? ""),
        eventDetail: String(e.eventDetail ?? ""),
        income: toInt(e.income),
        expense: toInt(e.expense),
        memo: String(e.memo ?? ""),
        createdAt: Number(e.createdAt ?? Date.now()),
      }))
      .filter((e) => e.date && e.client && e.eventName);
  } catch {
    return [];
  }
}

/** @param {Entry[]} entries */
function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function includesCaseInsensitive(haystack, needle) {
  const h = safeTrim(haystack).toLowerCase();
  const n = safeTrim(needle).toLowerCase();
  if (!n) return true;
  return h.includes(n);
}

/** @param {Entry[]} entries */
function sortEntries(entries) {
  // 날짜 내림차순, 동일 날짜면 생성시간 내림차순
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
}

function openConfirm({ title, body, danger = true }) {
  const dialog = $("confirmDialog");
  const titleEl = $("confirmTitle");
  const bodyEl = $("confirmBody");
  const okBtn = $("confirmOk");

  titleEl.textContent = title;
  bodyEl.textContent = body;
  okBtn.classList.toggle("btn--danger", danger);
  okBtn.classList.toggle("btn--primary", !danger);

  dialog.showModal();
  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener("close", onClose);
      resolve(dialog.returnValue === "ok");
    };
    dialog.addEventListener("close", onClose);
  });
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(entries) {
  const header = ["날짜", "거래처", "행사명", "행사내역", "입금", "지출", "비고"];
  const rows = entries.map((e) => [
    e.date,
    e.client,
    e.eventName,
    e.eventDetail ?? "",
    String(e.income ?? 0),
    String(e.expense ?? 0),
    e.memo ?? "",
  ]);

  // Excel 호환을 위해 BOM 포함 (UTF-8)
  const escapeCell = (v) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };

  const lines = [header, ...rows].map((r) => r.map(escapeCell).join(","));
  return "\uFEFF" + lines.join("\n");
}

// --- UI 렌더링 ---

/** @param {Entry[]} entries */
function renderEntryTable(entries) {
  const tbody = $("entryTable").querySelector("tbody");
  tbody.innerHTML = "";

  const sorted = sortEntries(entries);
  $("entryCount").textContent = `${sorted.length}건`;

  for (const e of sorted) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e.date}</td>
      <td>${escapeHtml(e.client)}</td>
      <td>${escapeHtml(e.eventName)}</td>
      <td>${escapeHtml(e.eventDetail || "")}</td>
      <td class="num">${formatNumberKRW(e.income || 0)}</td>
      <td class="num">${formatNumberKRW(e.expense || 0)}</td>
      <td>${escapeHtml(e.memo || "")}</td>
      <td class="actions">
        <div class="btnRow">
          <button class="miniBtn miniBtn--danger" data-action="delete" data-id="${e.id}" type="button">삭제</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

/** @param {Entry[]} filtered */
function renderReportTable(filtered) {
  const tbody = $("reportTable").querySelector("tbody");
  tbody.innerHTML = "";

  const sorted = sortEntries(filtered).reverse(); // 날짜 오름차순
  $("reportCount").textContent = `${sorted.length}건`;

  for (const e of sorted) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e.date}</td>
      <td>${escapeHtml(e.client)}</td>
      <td>${escapeHtml(e.eventDetail || "")}</td>
      <td class="num">${formatNumberKRW(e.income || 0)}</td>
      <td class="num">${formatNumberKRW(e.expense || 0)}</td>
      <td>${escapeHtml(e.memo || "")}</td>
    `;
    tbody.appendChild(tr);
  }
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function switchTab(tab) {
  const isEntry = tab === "entry";
  const isReport = tab === "report";
  const isProfit = tab === "profit";

  $("tabEntry").classList.toggle("tab--active", isEntry);
  $("tabEntry").setAttribute("aria-selected", isEntry ? "true" : "false");
  $("panelEntry").classList.toggle("panel--active", isEntry);

  $("tabReport").classList.toggle("tab--active", isReport);
  $("tabReport").setAttribute("aria-selected", isReport ? "true" : "false");
  $("panelReport").classList.toggle("panel--active", isReport);

  $("tabProfit").classList.toggle("tab--active", isProfit);
  $("tabProfit").setAttribute("aria-selected", isProfit ? "true" : "false");
  $("panelProfit").classList.toggle("panel--active", isProfit);
}

// --- 이벤트 바인딩 ---

let entries = loadEntries();

/**
 * 행사별 정산서 추가 입력값(사용자 직접 입력)
 * - key: safeEventKey(eventName)
 */
function loadReportMap() {
  try {
    const raw = localStorage.getItem(REPORT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveReportMap(map) {
  localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(map));
}

/**
 * 수익 탭 저장 데이터
 * {
 *   incomes: { [eventKey]: { eventName, enabled, amountOverride } },
 *   expenses: Array<{ id, label, amount }>
 * }
 */
function loadProfitState() {
  try {
    const raw = localStorage.getItem(PROFIT_STORAGE_KEY);
    if (!raw) return { incomes: {}, expenses: [] };
    const parsed = JSON.parse(raw);
    return {
      incomes: parsed?.incomes && typeof parsed.incomes === "object" ? parsed.incomes : {},
      expenses: Array.isArray(parsed?.expenses) ? parsed.expenses : [],
    };
  } catch {
    return { incomes: {}, expenses: [] };
  }
}

function saveProfitState(state) {
  localStorage.setItem(PROFIT_STORAGE_KEY, JSON.stringify(state));
}

let reportMap = loadReportMap();
let profitState = loadProfitState();
let selectedEventKey = "";

function cssEscape(value) {
  // CSS.escape 지원 여부 대비
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(String(value));
  return String(value).replaceAll('"', '\\"');
}

function rerenderAllPreserveFocus() {
  const active = document.activeElement;
  const focusInfo =
    active && active instanceof HTMLElement
      ? {
          id: active.id || null,
          action: active.dataset?.action || null,
          key: active.dataset?.key || null,
          rowId: active.dataset?.id || null,
          selectionStart: active instanceof HTMLInputElement ? active.selectionStart : null,
          selectionEnd: active instanceof HTMLInputElement ? active.selectionEnd : null,
        }
      : null;

  rerenderAll();

  if (!focusInfo) return;

  /** @type {HTMLElement | null} */
  let next = null;
  if (focusInfo.id) next = document.getElementById(focusInfo.id);
  if (!next && focusInfo.action) {
    const parts = [`[data-action="${cssEscape(focusInfo.action)}"]`];
    if (focusInfo.key) parts.push(`[data-key="${cssEscape(focusInfo.key)}"]`);
    if (focusInfo.rowId) parts.push(`[data-id="${cssEscape(focusInfo.rowId)}"]`);
    next = document.querySelector(parts.join(""));
  }

  if (next && next instanceof HTMLElement) {
    next.focus({ preventScroll: true });
    if (next instanceof HTMLInputElement && focusInfo.selectionStart !== null && focusInfo.selectionEnd !== null) {
      try {
        next.setSelectionRange(focusInfo.selectionStart, focusInfo.selectionEnd);
      } catch {
        // 일부 input type에서는 setSelectionRange 불가
      }
    }
  }
}

function rerenderAll() {
  renderEntryTable(entries);
  renderEventList();
  renderSelectedReport();
  renderProfitTab();
}

function getEventNamesFromEntries() {
  const set = new Map(); // key -> original display name (최근것 우선)
  for (const e of sortEntries(entries)) {
    const name = safeTrim(e.eventName);
    if (!name) continue;
    const key = safeEventKey(name);
    if (!set.has(key)) set.set(key, name);
  }
  return [...set.entries()].map(([key, name]) => ({ key, name }));
}

function getEntriesByEventKey(eventKey) {
  if (!eventKey) return [];
  return entries.filter((e) => safeEventKey(e.eventName) === eventKey);
}

function ensureReportDefaults(eventKey, displayName) {
  if (!eventKey) return;
  if (!reportMap[eventKey]) {
    reportMap[eventKey] = {
      eventName: displayName || "",
      fixedPrice: 0,
      bahtKrw: 0,
      tip: 0,
      optionProfit: 0,
      shoppingProfit: 0,
      otherExpense: 0,
      updatedAt: Date.now(),
    };
    saveReportMap(reportMap);
  } else if (!reportMap[eventKey].eventName && displayName) {
    reportMap[eventKey].eventName = displayName;
    saveReportMap(reportMap);
  }
}

function computeEventSummary(eventKey) {
  const list = getEntriesByEventKey(eventKey);
  const baseIncome = list.reduce((acc, e) => acc + (e.income || 0), 0);
  const baseExpense = list.reduce((acc, e) => acc + (e.expense || 0), 0);
  const r = reportMap[eventKey] || {};

  // 바트환산은 "일단 구현만" 단계: 저장/표시는 하되 어떤 계산에도 관여하지 않음
  // (나중에 사용처가 확정되면 totalIncome 등에 반영)
  // const bahtKrw = toInt(r.bahtKrw);
  const tip = toInt(r.tip);
  const optionProfit = toInt(r.optionProfit);
  const shoppingProfit = toInt(r.shoppingProfit);
  const otherExpense = toInt(r.otherExpense);

  const totalIncome = baseIncome + tip + optionProfit + shoppingProfit;
  const totalExpense = baseExpense + otherExpense;
  const totalProfit = totalIncome - totalExpense;

  return { baseIncome, baseExpense, totalIncome, totalExpense, totalProfit, count: list.length };
}

function renderEventList() {
  const listEl = $("eventList");
  listEl.innerHTML = "";

  const events = getEventNamesFromEntries();
  $("eventCount").textContent = `${events.length}건`;

  if (events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "아직 저장된 행사명이 없습니다.";
    listEl.appendChild(empty);
    selectedEventKey = "";
    return;
  }

  // 선택된 것이 없으면 첫 행사 자동 선택
  if (!selectedEventKey || !events.some((e) => e.key === selectedEventKey)) {
    selectedEventKey = events[0].key;
  }

  for (const ev of events) {
    ensureReportDefaults(ev.key, ev.name);
    const summary = computeEventSummary(ev.key);

    const item = document.createElement("div");
    item.className = `listItem ${ev.key === selectedEventKey ? "listItem--active" : ""}`;
    item.setAttribute("role", "listitem");
    item.dataset.key = ev.key;
    item.innerHTML = `
      <div class="listItem__title">${escapeHtml(ev.name)}</div>
      <div class="listItem__meta">
        <span>내역 ${summary.count}건</span>
        <span>수익 ${formatNumberKRW(summary.totalProfit)}</span>
      </div>
    `;
    listEl.appendChild(item);
  }
}

function renderSelectedReport() {
  const hasSelection = Boolean(selectedEventKey);
  const titleEl = $("reportTitle");

  if (!hasSelection) {
    titleEl.textContent = "행사를 선택하세요";
    $("sumIncome").textContent = "0";
    $("sumExpense").textContent = "0";
    $("sumTotal").textContent = "0";
    renderReportTable([]);
    setReportInputsEnabled(false);
    return;
  }

  const events = getEventNamesFromEntries();
  const displayName = events.find((e) => e.key === selectedEventKey)?.name || "";
  ensureReportDefaults(selectedEventKey, displayName);

  titleEl.textContent = displayName ? `정산서 · ${displayName}` : "정산서";
  setReportInputsEnabled(true);
  syncReportInputsFromState(selectedEventKey);

  const filtered = getEntriesByEventKey(selectedEventKey);
  renderReportTable(filtered);

  const summary = computeEventSummary(selectedEventKey);
  $("sumIncome").textContent = formatNumberKRW(summary.totalIncome);
  $("sumExpense").textContent = formatNumberKRW(summary.totalExpense);
  $("sumTotal").textContent = formatNumberKRW(summary.totalProfit);
}

function setReportInputsEnabled(enabled) {
  const ids = [
    "reportFixedPrice",
    "reportBahtKrw",
    "reportTip",
    "reportOptionProfit",
    "reportShoppingProfit",
    "reportOtherExpense",
  ];
  for (const id of ids) {
    const el = $(id);
    el.disabled = !enabled;
  }
}

function syncReportInputsFromState(eventKey) {
  const r = reportMap[eventKey] || {};
  $("reportFixedPrice").value = String(toInt(r.fixedPrice));
  $("reportBahtKrw").value = String(toInt(r.bahtKrw));
  $("reportTip").value = String(toInt(r.tip));
  $("reportOptionProfit").value = String(toInt(r.optionProfit));
  $("reportShoppingProfit").value = String(toInt(r.shoppingProfit));
  $("reportOtherExpense").value = String(toInt(r.otherExpense));
}

function updateReportField(eventKey, patch) {
  if (!eventKey) return;
  reportMap[eventKey] = { ...(reportMap[eventKey] || {}), ...patch, updatedAt: Date.now() };
  saveReportMap(reportMap);
}

function renderProfitTab() {
  // 정산서 목록으로 수입 테이블 구성
  const events = getEventNamesFromEntries();
  const tbody = $("profitIncomeTable").querySelector("tbody");
  tbody.innerHTML = "";

  // 상태에 누락된 행사 추가
  for (const ev of events) {
    if (!profitState.incomes[ev.key]) {
      profitState.incomes[ev.key] = { eventName: ev.name, enabled: true, amountOverride: null };
    } else {
      // 표시명 최신화(사용자가 행사명을 입력에서 바꿀 수 있으니)
      profitState.incomes[ev.key].eventName = ev.name;
    }
  }

  // 상태에만 있고 실제 entries에 없는 행사(삭제된 행사)는 그대로 두되 비활성 표시
  const rows = Object.entries(profitState.incomes).map(([key, v]) => ({ key, ...v }));
  $("profitIncomeCount").textContent = `${rows.length}건`;

  let sumIncome = 0;
  for (const row of rows) {
    const exists = events.some((e) => e.key === row.key);
    const computed = exists ? computeEventSummary(row.key).totalProfit : 0;
    const override =
      row.amountOverride === null || row.amountOverride === undefined ? null : toInt(row.amountOverride);
    const amount = override ?? computed;

    const enabled = Boolean(row.enabled) && exists;
    if (enabled) sumIncome += amount;

    const tr = document.createElement("tr");

    const tdCheck = document.createElement("td");
    tdCheck.className = "actions";
    const cb = document.createElement("input");
    cb.className = "checkbox";
    cb.type = "checkbox";
    cb.dataset.action = "income-toggle";
    cb.dataset.key = row.key;
    cb.checked = enabled;
    cb.disabled = !exists;
    tdCheck.appendChild(cb);

    const tdName = document.createElement("td");
    tdName.textContent = row.eventName || "(행사명 없음)";
    if (!exists) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.style.marginLeft = "8px";
      badge.textContent = "내역 없음";
      tdName.appendChild(badge);
    }

    const tdAmount = document.createElement("td");
    tdAmount.className = "num";
    const amountInput = document.createElement("input");
    amountInput.className = "input";
    amountInput.type = "number";
    amountInput.min = "0";
    amountInput.step = "1";
    amountInput.style.maxWidth = "220px";
    amountInput.style.textAlign = "right";
    amountInput.dataset.action = "income-amount";
    amountInput.dataset.key = row.key;
    amountInput.value = String(amount);
    amountInput.disabled = !exists;
    tdAmount.appendChild(amountInput);

    tr.appendChild(tdCheck);
    tr.appendChild(tdName);
    tr.appendChild(tdAmount);
    tbody.appendChild(tr);
  }

  // 지출 테이블
  const expBody = $("profitExpenseTable").querySelector("tbody");
  expBody.innerHTML = "";

  let sumExpense = 0;
  for (const ex of profitState.expenses) {
    const amount = toInt(ex.amount);
    sumExpense += amount;
    const tr = document.createElement("tr");

    const tdLabel = document.createElement("td");
    const labelInput = document.createElement("input");
    labelInput.className = "input";
    labelInput.type = "text";
    labelInput.dataset.action = "expense-label";
    labelInput.dataset.id = ex.id;
    labelInput.value = ex.label || "";
    tdLabel.appendChild(labelInput);

    const tdAmt = document.createElement("td");
    tdAmt.className = "num";
    const amtInput = document.createElement("input");
    amtInput.className = "input";
    amtInput.type = "number";
    amtInput.min = "0";
    amtInput.step = "1";
    amtInput.style.maxWidth = "220px";
    amtInput.style.textAlign = "right";
    amtInput.dataset.action = "expense-amount";
    amtInput.dataset.id = ex.id;
    amtInput.value = String(amount);
    tdAmt.appendChild(amtInput);

    const tdAct = document.createElement("td");
    tdAct.className = "actions";
    const delBtn = document.createElement("button");
    delBtn.className = "miniBtn miniBtn--danger";
    delBtn.type = "button";
    delBtn.dataset.action = "expense-delete";
    delBtn.dataset.id = ex.id;
    delBtn.textContent = "삭제";
    tdAct.appendChild(delBtn);

    tr.appendChild(tdLabel);
    tr.appendChild(tdAmt);
    tr.appendChild(tdAct);
    expBody.appendChild(tr);
  }

  $("profitSumIncome").textContent = formatNumberKRW(sumIncome);
  $("profitSumExpense").textContent = formatNumberKRW(sumExpense);
  $("profitSumTotal").textContent = formatNumberKRW(sumIncome - sumExpense);

  saveProfitState(profitState);
}

function init() {
  // 탭
  $("tabEntry").addEventListener("click", () => switchTab("entry"));
  $("tabReport").addEventListener("click", () => {
    switchTab("report");
    rerenderAllPreserveFocus();
  });
  $("tabProfit").addEventListener("click", () => {
    switchTab("profit");
    rerenderAllPreserveFocus();
  });

  // 폼
  const form = $("entryForm");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const date = String(fd.get("date") || "");
    const client = safeTrim(fd.get("client"));
    const eventName = safeTrim(fd.get("eventName"));
    const eventDetail = safeTrim(fd.get("eventDetail"));
    const income = toInt(fd.get("income"));
    const expense = toInt(fd.get("expense"));
    const memo = safeTrim(fd.get("memo"));

    if (!date || !client || !eventName) return;

    const entry = {
      id: makeId(),
      date,
      client,
      eventName,
      eventDetail,
      income,
      expense,
      memo,
      createdAt: Date.now(),
    };

    entries = [entry, ...entries];
    saveEntries(entries);
    // 행사 정산서 기본값 생성(자동)
    ensureReportDefaults(safeEventKey(entry.eventName), entry.eventName);
    rerenderAllPreserveFocus();
    form.reset();
    // 기본값 유지
    form.querySelector('input[name="income"]').value = "0";
    form.querySelector('input[name="expense"]').value = "0";
  });

  $("btnResetForm").addEventListener("click", () => {
    form.reset();
    form.querySelector('input[name="income"]').value = "0";
    form.querySelector('input[name="expense"]').value = "0";
  });

  // 목록 삭제 버튼(위임)
  $("entryTable").addEventListener("click", async (ev) => {
    const btn = ev.target instanceof HTMLElement ? ev.target.closest("button") : null;
    if (!btn) return;
    if (btn.dataset.action !== "delete") return;
    const id = btn.dataset.id;
    if (!id) return;

    const ok = await openConfirm({
      title: "삭제 확인",
      body: "이 항목을 삭제할까요? (되돌릴 수 없습니다)",
      danger: true,
    });
    if (!ok) return;

    entries = entries.filter((e) => e.id !== id);
    saveEntries(entries);
    rerenderAllPreserveFocus();
  });

  // 행사 목록 클릭(위임)
  $("eventList").addEventListener("click", (ev) => {
    const el = ev.target instanceof HTMLElement ? ev.target.closest("[data-key]") : null;
    if (!el) return;
    const key = el.dataset.key;
    if (!key) return;
    selectedEventKey = key;
    rerenderAllPreserveFocus();
  });

  // 정산서 입력값 변경(행사 단위 저장)
  const bindReportNumberInput = (id, field) => {
    $(id).addEventListener("input", () => {
      if (!selectedEventKey) return;
      updateReportField(selectedEventKey, { [field]: toInt($(id).value) });
        rerenderAllPreserveFocus();
    });
  };
  bindReportNumberInput("reportFixedPrice", "fixedPrice");
  bindReportNumberInput("reportBahtKrw", "bahtKrw");
  bindReportNumberInput("reportTip", "tip");
  bindReportNumberInput("reportOptionProfit", "optionProfit");
  bindReportNumberInput("reportShoppingProfit", "shoppingProfit");
  bindReportNumberInput("reportOtherExpense", "otherExpense");

  // 정산서 CSV
  $("btnExportReportCsv").addEventListener("click", () => {
    if (!selectedEventKey) return;
    const events = getEventNamesFromEntries();
    const name = events.find((e) => e.key === selectedEventKey)?.name || "정산서";
    const list = getEntriesByEventKey(selectedEventKey);
    const r = reportMap[selectedEventKey] || {};
    const summary = computeEventSummary(selectedEventKey);

    const header = [
      "행사명",
      "확정가",
      "바트환산(원)",
      "팁",
      "옵션수익",
      "쇼핑수익",
      "기타 지출",
      "총 입금",
      "총 지출액",
      "총 수익",
      "",
      "날짜",
      "거래처",
      "행사내역",
      "입금",
      "지출",
      "비고",
    ];
    const metaRow = [
      name,
      String(toInt(r.fixedPrice)),
      String(toInt(r.bahtKrw)),
      String(toInt(r.tip)),
      String(toInt(r.optionProfit)),
      String(toInt(r.shoppingProfit)),
      String(toInt(r.otherExpense)),
      String(summary.totalIncome),
      String(summary.totalExpense),
      String(summary.totalProfit),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ];

    const rows = list
      .slice()
      .sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0))
      .map((e) => ["", "", "", "", "", "", "", "", "", "", "", e.date, e.client, e.eventDetail, e.income, e.expense, e.memo]);

    const escapeCell = (v) => {
      const s = String(v ?? "");
      if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
      return s;
    };
    const lines = [header, metaRow, ...rows].map((r) => r.map(escapeCell).join(","));
    downloadTextFile(`정산서_${name}.csv`, "\uFEFF" + lines.join("\n"));
  });

  // 수익 CSV
  $("btnExportProfitCsv").addEventListener("click", () => {
    // income rows
    const incomeRows = Object.entries(profitState.incomes).map(([key, v]) => {
      const exists = getEventNamesFromEntries().some((e) => e.key === key);
      const computed = exists ? computeEventSummary(key).totalProfit : 0;
      const override =
        v.amountOverride === null || v.amountOverride === undefined ? null : toInt(v.amountOverride);
      const amount = override ?? computed;
      const enabled = Boolean(v.enabled) && exists;
      return [enabled ? "Y" : "N", v.eventName || "", String(amount)];
    });

    const expRows = profitState.expenses.map((e) => [e.label || "", String(toInt(e.amount))]);

    const header = ["구분", "항목", "금액"];
    const lines = [header];
    lines.push(["수입", "행사명", "총 수익"]);
    for (const r of incomeRows) lines.push(["수입", r[1], r[2]]);
    lines.push(["", "", ""]);
    lines.push(["지출", "항목", "금액"]);
    for (const r of expRows) lines.push(["지출", r[0], r[1]]);

    const escapeCell = (v) => {
      const s = String(v ?? "");
      if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
      return s;
    };
    downloadTextFile("수익.csv", "\uFEFF" + lines.map((r) => r.map(escapeCell).join(",")).join("\n"));
  });

  // 전체 삭제
  $("btnClearAll").addEventListener("click", async () => {
    const ok = await openConfirm({
      title: "전체 삭제",
      body: "저장된 모든 내역을 삭제할까요? (되돌릴 수 없습니다)",
      danger: true,
    });
    if (!ok) return;
    entries = [];
    saveEntries(entries);
    reportMap = {};
    saveReportMap(reportMap);
    profitState = { incomes: {}, expenses: [] };
    saveProfitState(profitState);
    rerenderAllPreserveFocus();
  });

  // 수익 탭: 수입/지출 이벤트(위임)
  $("profitIncomeTable").addEventListener("change", (ev) => {
    const el = ev.target instanceof HTMLElement ? ev.target : null;
    if (!el) return;
    const action = el.dataset.action;
    const key = el.dataset.key;
    if (!action || !key) return;
    if (!profitState.incomes[key]) return;

    if (action === "income-toggle" && el instanceof HTMLInputElement) {
      profitState.incomes[key].enabled = el.checked;
      saveProfitState(profitState);
      rerenderAllPreserveFocus();
    }
  });

  $("profitIncomeTable").addEventListener("input", (ev) => {
    const el = ev.target instanceof HTMLElement ? ev.target : null;
    if (!el) return;
    const action = el.dataset.action;
    const key = el.dataset.key;
    if (action !== "income-amount" || !key) return;
    if (!profitState.incomes[key]) return;
    profitState.incomes[key].amountOverride = toInt(el.value);
    saveProfitState(profitState);
    rerenderAllPreserveFocus();
  });

  $("btnAddProfitExpense").addEventListener("click", () => {
    profitState.expenses.push({ id: makeId(), label: "", amount: 0 });
    saveProfitState(profitState);
    rerenderAllPreserveFocus();
  });

  $("profitExpenseTable").addEventListener("click", (ev) => {
    const btn = ev.target instanceof HTMLElement ? ev.target.closest("button") : null;
    if (!btn) return;
    if (btn.dataset.action !== "expense-delete") return;
    const id = btn.dataset.id;
    if (!id) return;
    profitState.expenses = profitState.expenses.filter((e) => e.id !== id);
    saveProfitState(profitState);
    rerenderAllPreserveFocus();
  });

  $("profitExpenseTable").addEventListener("input", (ev) => {
    const el = ev.target instanceof HTMLElement ? ev.target : null;
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;
    if (!action || !id) return;
    const idx = profitState.expenses.findIndex((e) => e.id === id);
    if (idx < 0) return;
    if (action === "expense-label") profitState.expenses[idx].label = el.value;
    if (action === "expense-amount") profitState.expenses[idx].amount = toInt(el.value);
    saveProfitState(profitState);
    rerenderAllPreserveFocus();
  });

  // 최초 렌더
  rerenderAll();
}

init();

