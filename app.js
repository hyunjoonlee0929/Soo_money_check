/**
 * 정산 앱 (의존성 없음)
 * - 입력/저장: 거래 내역 저장 (4가지 통화: 원화, 방콕뱅크, 카시컨, 달러)
 * - 정산서(행사별): 월별 > 행사명 단위로 내역 묶고, 가이드 정산 포함
 * - 수익: 월별로 묶어서 여러 정산서(행사) 합산 + 지출 직접 입력
 * - 저장: localStorage
 */

const STORAGE_KEY = "soo_money_check_entries_v2";
const REPORT_STORAGE_KEY = "soo_money_check_event_reports_v2";
const PROFIT_STORAGE_KEY = "soo_money_check_profit_tab_v2";

/** @typedef {{
 *  id: string,
 *  date: string, // YYYY-MM-DD
 *  client: string,
 *  eventName: string,
 *  eventDetail: string,
 *  krwIncome: number,
 *  krwExpense: number,
 *  bbIncome: number,
 *  bbExpense: number,
 *  kbIncome: number,
 *  kbExpense: number,
 *  usdIncome: number,
 *  usdExpense: number,
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

function toFloat(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n; // 음수도 허용
}

function makeId() {
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeEventKey(eventName, yearMonth) {
  // 월+행사명 조합으로 키 생성 (같은 행사명이라도 다른 월이면 다른 정산서)
  const ym = yearMonth || "";
  const name = safeTrim(eventName).toLowerCase();
  return ym ? `${ym}::${name}` : name;
}

// 날짜 자동 변환: 20260202 -> 2026-02-02
function parseInputDate(input) {
  const trimmed = safeTrim(input).replace(/[^0-9]/g, "");
  if (trimmed.length === 8) {
    const year = trimmed.substring(0, 4);
    const month = trimmed.substring(4, 6);
    const day = trimmed.substring(6, 8);
    return `${year}-${month}-${day}`;
  }
  return input;
}

// YYYY-MM-DD에서 YYYY-MM 추출
function getYearMonth(dateStr) {
  if (!dateStr || dateStr.length < 7) return "";
  return dateStr.substring(0, 7);
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
        krwIncome: toFloat(e.krwIncome),
        krwExpense: toFloat(e.krwExpense),
        bbIncome: toFloat(e.bbIncome),
        bbExpense: toFloat(e.bbExpense),
        kbIncome: toFloat(e.kbIncome),
        kbExpense: toFloat(e.kbExpense),
        usdIncome: toFloat(e.usdIncome),
        usdExpense: toFloat(e.usdExpense),
        memo: String(e.memo ?? ""),
        createdAt: Number(e.createdAt ?? Date.now()),
      }))
      .filter((e) => e.date); // 날짜만 필수
  } catch {
    return [];
  }
}

/** @param {Entry[]} entries */
function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/** @param {Entry[]} entries */
function sortEntries(entries) {
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

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// --- 월별 그룹화 ---
function groupByMonth(entries) {
  const groups = {};
  for (const e of entries) {
    const ym = getYearMonth(e.date);
    if (!ym) continue;
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(e);
  }
  return groups;
}

// --- 입력/저장 탭 렌더링 (월별 정리, 날짜 내림차순, 잔액은 오래된 날짜부터 계산) ---
function renderEntryTable(entries) {
  const tbody = $("entryTable").querySelector("tbody");
  tbody.innerHTML = "";

  const sorted = sortEntries(entries); // 날짜 내림차순 정렬됨
  $("entryCount").textContent = `${sorted.length}건`;

  const grouped = groupByMonth(sorted);
  const months = Object.keys(grouped).sort().reverse(); // 최신 월이 위로

  // 잔액 계산을 위해 전체 데이터를 오래된 날짜부터 순회
  const allSortedForBalance = [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? 1 : -1;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });

  // 각 항목의 잔액을 미리 계산
  const balanceMap = {};
  let krwBalance = 0, bbBalance = 0, kbBalance = 0, usdBalance = 0;
  for (const e of allSortedForBalance) {
    krwBalance += (e.krwIncome - e.krwExpense);
    bbBalance += (e.bbIncome - e.bbExpense);
    kbBalance += (e.kbIncome - e.kbExpense);
    usdBalance += (e.usdIncome - e.usdExpense);
    balanceMap[e.id] = {
      krw: krwBalance,
      bb: bbBalance,
      kb: kbBalance,
      usd: usdBalance,
    };
  }

  for (const ym of months) {
    const monthEntries = grouped[ym];
    
    // 월 헤더
    const headerTr = document.createElement("tr");
    headerTr.innerHTML = `<td colspan="18" class="month-header">${ym}</td>`;
    tbody.appendChild(headerTr);

    for (const e of monthEntries) {
      const balance = balanceMap[e.id] || { krw: 0, bb: 0, kb: 0, usd: 0 };

      const tr = document.createElement("tr");
      const monthDay = e.date.substring(5); // MM-DD
      tr.innerHTML = `
        <td class="compact">${monthDay}</td>
        <td class="compact">${escapeHtml(e.client || "-")}</td>
        <td class="compact">${escapeHtml(e.eventName || "-")}</td>
        <td class="compact">${escapeHtml(e.eventDetail || "-")}</td>
        <td class="num compact">${formatNumberKRW(e.krwIncome)}</td>
        <td class="num compact">${formatNumberKRW(e.krwExpense)}</td>
        <td class="num balance compact">${formatNumberKRW(balance.krw)}</td>
        <td class="num compact">${formatNumberKRW(e.bbIncome)}</td>
        <td class="num compact">${formatNumberKRW(e.bbExpense)}</td>
        <td class="num balance compact">${formatNumberKRW(balance.bb)}</td>
        <td class="num compact">${formatNumberKRW(e.kbIncome)}</td>
        <td class="num compact">${formatNumberKRW(e.kbExpense)}</td>
        <td class="num balance compact">${formatNumberKRW(balance.kb)}</td>
        <td class="num compact">${formatNumberKRW(e.usdIncome)}</td>
        <td class="num compact">${formatNumberKRW(e.usdExpense)}</td>
        <td class="num balance compact">${formatNumberKRW(balance.usd)}</td>
        <td class="actions">
          <button class="miniBtn miniBtn--danger" data-action="delete" data-id="${e.id}" type="button">삭제</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }
}

// CSV 내보내기 (입력/저장 탭) - 전체 또는 월별
function exportEntryCsv(entries, targetMonth = null) {
  const sorted = sortEntries(entries);
  const grouped = groupByMonth(sorted);
  
  let months;
  if (targetMonth) {
    months = [targetMonth];
  } else {
    months = Object.keys(grouped).sort().reverse();
  }

  const header = ["월", "월일", "거래처", "행사명", "내용", "원화입금", "원화출금", "원화잔액", "BB입금", "BB출금", "BB잔액", "카시컨입금", "카시컨출금", "카시컨잔액", "달러입금", "달러출금", "달러잔액"];
  const rows = [header];

  // 잔액 계산
  const allSortedForBalance = [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? 1 : -1;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });

  const balanceMap = {};
  let krwBalance = 0, bbBalance = 0, kbBalance = 0, usdBalance = 0;
  for (const e of allSortedForBalance) {
    krwBalance += (e.krwIncome - e.krwExpense);
    bbBalance += (e.bbIncome - e.bbExpense);
    kbBalance += (e.kbIncome - e.kbExpense);
    usdBalance += (e.usdIncome - e.usdExpense);
    balanceMap[e.id] = { krw: krwBalance, bb: bbBalance, kb: kbBalance, usd: usdBalance };
  }

  for (const ym of months) {
    if (!grouped[ym]) continue;
    const monthEntries = grouped[ym];
    
    for (const e of monthEntries) {
      const balance = balanceMap[e.id] || { krw: 0, bb: 0, kb: 0, usd: 0 };
      const monthDay = e.date.substring(5);
      
      rows.push([
        ym,
        monthDay,
        e.client || "-",
        e.eventName || "-",
        e.eventDetail || "-",
        String(e.krwIncome),
        String(e.krwExpense),
        String(balance.krw),
        String(e.bbIncome),
        String(e.bbExpense),
        String(balance.bb),
        String(e.kbIncome),
        String(e.kbExpense),
        String(balance.kb),
        String(e.usdIncome),
        String(e.usdExpense),
        String(balance.usd),
      ]);
    }
  }

  const escapeCell = (v) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  const lines = rows.map((r) => r.map(escapeCell).join(","));
  const filename = targetMonth ? `입력내역_${targetMonth}.csv` : "입력내역_전체.csv";
  downloadTextFile(filename, "\uFEFF" + lines.join("\n"));
}

// 월별 CSV 버튼 렌더링
function renderMonthlyExportButtons() {
  const container = $("monthlyExportButtons");
  container.innerHTML = "";
  
  const grouped = groupByMonth(entries);
  const months = Object.keys(grouped).sort().reverse();
  
  for (const ym of months) {
    const btn = document.createElement("button");
    btn.className = "btn btn--ghost btn--sm";
    btn.textContent = `${ym} CSV`;
    btn.addEventListener("click", () => exportEntryCsv(entries, ym));
    container.appendChild(btn);
  }
}

// --- 정산서 관련 ---
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

// 행사명 목록 추출 (월별로 완전 분리)
function getEventNamesFromEntries() {
  const map = {};
  for (const e of entries) {
    if (!e.eventName || !e.client) continue; // 행사명과 거래처가 있는 경우만
    const ym = getYearMonth(e.date);
    const key = safeEventKey(e.eventName, ym);
    if (!map[key]) {
      map[key] = { key, name: e.eventName, month: ym };
    }
  }
  return Object.values(map);
}

function getEntriesByEventKey(eventKey) {
  // eventKey는 "YYYY-MM::행사명" 형식
  const parts = eventKey.split("::");
  const targetMonth = parts[0];
  const targetName = parts[1] ? parts[1] : eventKey;
  
  return entries.filter((e) => {
    if (!e.eventName || !e.client) return false;
    const ym = getYearMonth(e.date);
    const key = safeEventKey(e.eventName, ym);
    return key === eventKey;
  });
}

function ensureReportDefaults(eventKey, eventName) {
  if (!reportMap[eventKey]) {
    reportMap[eventKey] = {
      eventName,
      // 입금
      fixedPriceKRWIncome: 0, // 원화 확정가 (입금)
      bahtExchangeRateIncome: 0, // 바트환산 (입금)
      fixedPriceBahtIncome: 0, // 바트 확정가 (입금)
      // 지출
      fixedPriceKRWExpense: 0, // 원화 확정가 (지출)
      bahtExchangeRateExpense: 0, // 바트환산 (지출)
      fixedPriceBahtExpense: 0, // 바트 확정가 (지출)
      
      additionalItems: [], // { id, name, income, expense }
      // 가이드 정산
      tourFee: 0,
      optionSales: 0,
      otherIncome: 0,
      eventCost: 0,
      optionCost: 0,
      guideDailyFee: 0,
      guideCommission: 0,
      otherPayment: 0,
      guideOptions: [], // { id, optionName, salePrice, costPrice, profit, vendor }
    };
    saveReportMap(reportMap);
  }
}

function updateReportField(eventKey, updates) {
  if (!reportMap[eventKey]) return;
  Object.assign(reportMap[eventKey], updates);
  saveReportMap(reportMap);
}

function computeEventSummary(eventKey) {
  const list = getEntriesByEventKey(eventKey);
  const r = reportMap[eventKey] || {};

  // 원화 입금/지출 합계 (입력/저장 탭에서 가져온 값)
  const krwIncomeFromEntries = list.reduce((sum, e) => sum + (e.krwIncome || 0), 0);
  const krwExpenseFromEntries = list.reduce((sum, e) => sum + (e.krwExpense || 0), 0);
  
  // 바트 입금가 = 방콕뱅크 입금 + 카시컨 입금
  const bahtIncomeFromEntries = list.reduce((sum, e) => {
    return sum + (e.bbIncome || 0) + (e.kbIncome || 0);
  }, 0);
  
  // 바트 지출가 = 방콕뱅크 지출 + 카시컨 지출
  const bahtExpenseFromEntries = list.reduce((sum, e) => {
    return sum + (e.bbExpense || 0) + (e.kbExpense || 0);
  }, 0);
  
  // 바트 확정가 (입금) - 정산서에서 입력한 값
  const bahtFixedIncome = toFloat(r.fixedPriceBahtIncome);
  
  // 바트 확정가 (지출) - 정산서에서 입력한 값
  const bahtFixedExpense = toFloat(r.fixedPriceBahtExpense);

  // 추가 항목 합계
  const additionalIncome = (r.additionalItems || []).reduce((sum, item) => sum + toFloat(item.income), 0);
  const additionalExpense = (r.additionalItems || []).reduce((sum, item) => sum + toFloat(item.expense), 0);

  // 총 입금 = 바트 확정가(입금) + BB+KB + 추가항목
  const totalIncome = bahtFixedIncome + bahtIncomeFromEntries + additionalIncome;
  
  // 총 지출액 = 바트 확정가(지출) + BB지출 + KB지출 + 추가항목
  const totalExpense = bahtFixedExpense + bahtExpenseFromEntries + additionalExpense;
  
  const totalProfit = totalIncome - totalExpense;

  return { 
    totalIncome, 
    totalExpense, 
    totalProfit,
    bahtIncomeFromEntries,
    bahtExpenseFromEntries,
    krwIncomeFromEntries,
    krwExpenseFromEntries
  };
}

// --- 정산서 렌더링 (월별 그룹화) ---
let selectedEventKey = null;

function renderEventList() {
  const container = $("eventList");
  container.innerHTML = "";

  const events = getEventNamesFromEntries();
  $("eventCount").textContent = `${events.length}건`;

  // 월별 그룹화
  const byMonth = {};
  for (const ev of events) {
    const ym = ev.month || "기타";
    if (!byMonth[ym]) byMonth[ym] = [];
    byMonth[ym].push(ev);
  }

  const months = Object.keys(byMonth).sort().reverse();

  for (const ym of months) {
    const monthDiv = document.createElement("div");
    monthDiv.className = "list-month-group";
    monthDiv.innerHTML = `<div class="list-month-header">${ym}</div>`;
    
    for (const ev of byMonth[ym]) {
      const summary = computeEventSummary(ev.key);
      const item = document.createElement("div");
      item.className = `listItem ${selectedEventKey === ev.key ? "listItem--active" : ""}`;
      item.dataset.key = ev.key;
      item.innerHTML = `
        <div class="listItem__title">${escapeHtml(ev.name)}</div>
        <div class="listItem__meta">
          <span>수익: ${formatNumberKRW(summary.totalProfit)}</span>
        </div>
      `;
      monthDiv.appendChild(item);
    }
    
    container.appendChild(monthDiv);
  }
}

function renderReportDetail() {
  if (!selectedEventKey) {
    $("reportTitle").textContent = "행사를 선택하세요";
    $("reportCount").textContent = "0건";
    $("reportTable").querySelector("tbody").innerHTML = "";
    $("sumIncome").textContent = "0";
    $("sumExpense").textContent = "0";
    $("sumTotal").textContent = "0";
    
    // 추가 항목 초기화
    $("additionalItemsTable").querySelector("tbody").innerHTML = "";
    
    // 가이드 정산 초기화
    $("guideOptionsTable").querySelector("tbody").innerHTML = "";
    $("guideSummaryIncome").textContent = "0";
    $("guideSummaryExpense").textContent = "0";
    $("guideSummaryProfit").textContent = "0";
    return;
  }

  const events = getEventNamesFromEntries();
  const event = events.find((e) => e.key === selectedEventKey);
  if (!event) return;

  $("reportTitle").textContent = event.name;

  const list = getEntriesByEventKey(selectedEventKey);
  const r = reportMap[selectedEventKey] || {};
  const summary = computeEventSummary(selectedEventKey);

  // 원화 입금/지출 합계 계산 (입력/저장 탭에서 가져온 값)
  const krwIncomeSum = summary.krwIncomeFromEntries;
  const krwExpenseSum = summary.krwExpenseFromEntries;
  
  // 입금 필드 - 원화 확정가는 입력/저장 탭의 원화 입금 합계를 디폴트로
  const krwIncome = r.fixedPriceKRWIncome !== undefined && r.fixedPriceKRWIncome !== 0 
    ? toFloat(r.fixedPriceKRWIncome) 
    : krwIncomeSum;
  const rateIncome = toFloat(r.bahtExchangeRateIncome);
  
  $("reportFixedPriceKRWIncome").value = krwIncome;
  $("reportBahtExchangeRateIncome").value = rateIncome;
  
  // 바트 확정가 (입금) - 원화 확정가 × 바트환산
  let bahtIncomeDefault = toFloat(r.fixedPriceBahtIncome);
  if (bahtIncomeDefault === 0 && rateIncome > 0) {
    bahtIncomeDefault = krwIncome * rateIncome;
  }
  $("reportFixedPriceBahtIncome").value = bahtIncomeDefault;
  $("reportBahtIncomeTotal").textContent = formatNumberKRW(summary.bahtIncomeFromEntries);

  // 지출 필드 - 원화 확정가는 입력/저장 탭의 원화 지출 합계를 디폴트로
  const krwExpense = r.fixedPriceKRWExpense !== undefined && r.fixedPriceKRWExpense !== 0
    ? toFloat(r.fixedPriceKRWExpense)
    : krwExpenseSum;
  const rateExpense = toFloat(r.bahtExchangeRateExpense);
  
  $("reportFixedPriceKRWExpense").value = krwExpense;
  $("reportBahtExchangeRateExpense").value = rateExpense;
  
  // 바트 확정가 (지출) - 원화 확정가 × 바트환산
  let bahtExpenseDefault = toFloat(r.fixedPriceBahtExpense);
  if (bahtExpenseDefault === 0 && rateExpense > 0) {
    bahtExpenseDefault = krwExpense * rateExpense;
  }
  $("reportFixedPriceBahtExpense").value = bahtExpenseDefault;
  $("reportBahtExpenseTotal").textContent = formatNumberKRW(summary.bahtExpenseFromEntries);

  // 추가 항목 테이블 렌더링
  renderAdditionalItems();

  // 가이드 정산 필드
  $("reportTourFee").value = toFloat(r.tourFee);
  $("reportOptionSales").value = toFloat(r.optionSales);
  $("reportOtherIncome").value = toFloat(r.otherIncome);
  $("reportEventCost").value = toFloat(r.eventCost);
  $("reportOptionCost").value = toFloat(r.optionCost);
  $("reportGuideDailyFee").value = toFloat(r.guideDailyFee);
  $("reportGuideCommission").value = toFloat(r.guideCommission);
  $("reportOtherPayment").value = toFloat(r.otherPayment);

  // 가이드 옵션 테이블
  renderGuideOptions();

  // 가이드 정산 요약
  const guideIncome = toFloat(r.tourFee) + toFloat(r.optionSales) + toFloat(r.otherIncome);
  const guideExpense = toFloat(r.eventCost) + toFloat(r.optionCost) + toFloat(r.guideDailyFee) + toFloat(r.guideCommission) + toFloat(r.otherPayment);
  const guideProfit = guideIncome - guideExpense;

  $("guideSummaryIncome").textContent = formatNumberKRW(guideIncome);
  $("guideSummaryExpense").textContent = formatNumberKRW(guideExpense);
  $("guideSummaryProfit").textContent = formatNumberKRW(guideProfit);

  // 요약
  $("sumIncome").textContent = formatNumberKRW(summary.totalIncome);
  $("sumExpense").textContent = formatNumberKRW(summary.totalExpense);
  $("sumTotal").textContent = formatNumberKRW(summary.totalProfit);

  // 테이블
  const tbody = $("reportTable").querySelector("tbody");
  tbody.innerHTML = "";
  const sorted = [...list].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
  $("reportCount").textContent = `${sorted.length}건`;

  for (const e of sorted) {
    // 각 항목의 입금 = 바트확정가(입금) + BB입금 + KB입금
    const itemIncome = bahtIncomeDefault + (e.bbIncome || 0) + (e.kbIncome || 0);
    // 각 항목의 지출 = 바트확정가(지출) + BB지출 + KB지출
    const itemExpense = bahtExpenseDefault + (e.bbExpense || 0) + (e.kbExpense || 0);
    
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e.date}</td>
      <td>${escapeHtml(e.client)}</td>
      <td>${escapeHtml(e.eventDetail || "")}</td>
      <td class="num">
        <input class="input input--sm num" type="number" step="any" value="${itemIncome}" data-action="entry-income" data-id="${e.id}" />
      </td>
      <td class="num">
        <input class="input input--sm num" type="number" step="any" value="${itemExpense}" data-action="entry-expense" data-id="${e.id}" />
      </td>
      <td>${escapeHtml(e.memo || "")}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderAdditionalItems() {
  if (!selectedEventKey) return;
  
  const r = reportMap[selectedEventKey] || {};
  const items = r.additionalItems || [];
  
  const tbody = $("additionalItemsTable").querySelector("tbody");
  tbody.innerHTML = "";
  
  for (const item of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input class="input input--sm" value="${escapeHtml(item.name || '')}" data-action="additional-item-name" data-id="${item.id}" /></td>
      <td><input class="input input--sm num" type="number" value="${item.income || 0}" data-action="additional-item-income" data-id="${item.id}" /></td>
      <td><input class="input input--sm num" type="number" value="${item.expense || 0}" data-action="additional-item-expense" data-id="${item.id}" /></td>
      <td class="actions">
        <button class="miniBtn miniBtn--danger" data-action="additional-item-delete" data-id="${item.id}" type="button">삭제</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function renderGuideOptions() {
  if (!selectedEventKey) return;
  
  const r = reportMap[selectedEventKey] || {};
  const options = r.guideOptions || [];
  
  const tbody = $("guideOptionsTable").querySelector("tbody");
  tbody.innerHTML = "";
  
  for (const opt of options) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input class="input input--sm" value="${escapeHtml(opt.optionName || '')}" data-action="guide-option-name" data-id="${opt.id}" /></td>
      <td><input class="input input--sm num" type="number" value="${opt.salePrice || 0}" data-action="guide-option-sale" data-id="${opt.id}" /></td>
      <td><input class="input input--sm num" type="number" value="${opt.costPrice || 0}" data-action="guide-option-cost" data-id="${opt.id}" /></td>
      <td class="num">${formatNumberKRW((opt.salePrice || 0) - (opt.costPrice || 0))}</td>
      <td><input class="input input--sm" value="${escapeHtml(opt.vendor || '')}" data-action="guide-option-vendor" data-id="${opt.id}" /></td>
      <td class="actions">
        <button class="miniBtn miniBtn--danger" data-action="guide-option-delete" data-id="${opt.id}" type="button">삭제</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

// --- 수익 탭 ---
function loadProfitState() {
  try {
    const raw = localStorage.getItem(PROFIT_STORAGE_KEY);
    if (!raw) return { incomes: {}, expenses: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { incomes: {}, expenses: [] };
    return {
      incomes: parsed.incomes || {},
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
    };
  } catch {
    return { incomes: {}, expenses: [] };
  }
}

function saveProfitState(state) {
  localStorage.setItem(PROFIT_STORAGE_KEY, JSON.stringify(state));
}

function syncProfitIncomes() {
  const events = getEventNamesFromEntries();
  for (const ev of events) {
    if (!profitState.incomes[ev.key]) {
      profitState.incomes[ev.key] = {
        eventName: ev.name,
        month: ev.month,
        enabled: true,
        amountOverride: null,
      };
    } else {
      profitState.incomes[ev.key].month = ev.month;
    }
  }
  saveProfitState(profitState);
}

function renderProfitTab() {
  syncProfitIncomes();

  // 수입 테이블 (월별 그룹화)
  const incomeBody = $("profitIncomeTable").querySelector("tbody");
  incomeBody.innerHTML = "";

  const incomesByMonth = {};
  for (const [key, v] of Object.entries(profitState.incomes)) {
    const ym = v.month || "기타";
    if (!incomesByMonth[ym]) incomesByMonth[ym] = [];
    incomesByMonth[ym].push({ key, ...v });
  }

  const months = Object.keys(incomesByMonth).sort().reverse();
  let enabledCount = 0;

  for (const ym of months) {
    const headerTr = document.createElement("tr");
    headerTr.innerHTML = `<td colspan="3" class="month-header">${ym}</td>`;
    incomeBody.appendChild(headerTr);

    for (const item of incomesByMonth[ym]) {
      const exists = getEventNamesFromEntries().some((e) => e.key === item.key);
      if (!exists) continue;

      const computed = computeEventSummary(item.key).totalProfit;
      const override = item.amountOverride !== null && item.amountOverride !== undefined ? toFloat(item.amountOverride) : null;
      const amount = override !== null ? override : computed;
      const enabled = Boolean(item.enabled);

      if (enabled) enabledCount++;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="actions">
          <input class="checkbox" type="checkbox" ${enabled ? "checked" : ""} data-action="income-toggle" data-key="${item.key}" />
        </td>
        <td>${escapeHtml(item.eventName || "")}</td>
        <td class="num">
          <input class="input input--sm num" type="number" step="any" value="${amount}" data-action="income-amount" data-key="${item.key}" />
        </td>
      `;
      incomeBody.appendChild(tr);
    }
  }

  $("profitIncomeCount").textContent = `${enabledCount}건`;

  // 지출 테이블
  const expenseBody = $("profitExpenseTable").querySelector("tbody");
  expenseBody.innerHTML = "";

  for (const exp of profitState.expenses) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input class="input input--sm" value="${escapeHtml(exp.label || '')}" data-action="expense-label" data-id="${exp.id}" /></td>
      <td class="num"><input class="input input--sm num" type="number" step="any" value="${exp.amount || 0}" data-action="expense-amount" data-id="${exp.id}" /></td>
      <td class="actions">
        <button class="miniBtn miniBtn--danger" data-action="expense-delete" data-id="${exp.id}" type="button">삭제</button>
      </td>
    `;
    expenseBody.appendChild(tr);
  }

  // 요약 계산
  let totalIncome = 0;
  for (const [key, v] of Object.entries(profitState.incomes)) {
    const exists = getEventNamesFromEntries().some((e) => e.key === key);
    if (!exists || !v.enabled) continue;
    const computed = computeEventSummary(key).totalProfit;
    const override = v.amountOverride !== null && v.amountOverride !== undefined ? toFloat(v.amountOverride) : null;
    const amount = override !== null ? override : computed;
    totalIncome += amount;
  }

  const totalExpense = profitState.expenses.reduce((sum, e) => sum + toFloat(e.amount), 0);
  const totalProfit = totalIncome - totalExpense;

  $("profitSumIncome").textContent = formatNumberKRW(totalIncome);
  $("profitSumExpense").textContent = formatNumberKRW(totalExpense);
  $("profitSumTotal").textContent = formatNumberKRW(totalProfit);
}

// CSV 내보내기 (수익 탭)
function exportProfitCsv() {
  const incomesByMonth = {};
  for (const [key, v] of Object.entries(profitState.incomes)) {
    const ym = v.month || "기타";
    if (!incomesByMonth[ym]) incomesByMonth[ym] = [];
    incomesByMonth[ym].push({ key, ...v });
  }

  const months = Object.keys(incomesByMonth).sort().reverse();

  const header = ["구분", "월", "항목", "금액"];
  const lines = [header];

  lines.push(["수입", "", "", ""]);
  for (const ym of months) {
    for (const item of incomesByMonth[ym]) {
      const exists = getEventNamesFromEntries().some((e) => e.key === item.key);
      if (!exists || !item.enabled) continue;

      const computed = computeEventSummary(item.key).totalProfit;
      const override = item.amountOverride !== null && item.amountOverride !== undefined ? toFloat(item.amountOverride) : null;
      const amount = override !== null ? override : computed;

      lines.push(["수입", ym, item.eventName || "", String(amount)]);
    }
  }

  lines.push(["", "", "", ""]);
  lines.push(["지출", "", "", ""]);
  for (const exp of profitState.expenses) {
    lines.push(["지출", "", exp.label || "", String(toFloat(exp.amount))]);
  }

  const escapeCell = (v) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  downloadTextFile("수익.csv", "\uFEFF" + lines.map((r) => r.map(escapeCell).join(",")).join("\n"));
}

// --- UI 전체 렌더링 ---
function rerenderAll() {
  renderEntryTable(entries);
  renderMonthlyExportButtons();
  renderEventList();
  renderReportDetail();
  renderProfitTab();
}

function rerenderAllPreserveFocus() {
  const activeEl = document.activeElement;
  const activeId = activeEl?.id || null;
  const activeDataAction = activeEl?.dataset?.action || null;
  const activeDataId = activeEl?.dataset?.id || null;
  const activeDataKey = activeEl?.dataset?.key || null;

  rerenderAll();

  // 포커스 복원 시도
  if (activeId) {
    try {
      $(activeId)?.focus();
    } catch {}
  } else if (activeDataAction) {
    const selector = `[data-action="${activeDataAction}"]${activeDataId ? `[data-id="${activeDataId}"]` : ""}${activeDataKey ? `[data-key="${activeDataKey}"]` : ""}`;
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement) el.focus();
  }
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

// --- 초기화 ---
let entries = loadEntries();
let reportMap = loadReportMap();
let profitState = loadProfitState();

function init() {
  // 탭 전환
  $("tabEntry").addEventListener("click", () => {
    switchTab("entry");
    rerenderAllPreserveFocus();
  });
  $("tabReport").addEventListener("click", () => {
    switchTab("report");
    rerenderAllPreserveFocus();
  });
  $("tabProfit").addEventListener("click", () => {
    switchTab("profit");
    rerenderAllPreserveFocus();
  });

  // 폼 제출
  const form = $("entryForm");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    
    let dateInput = String(fd.get("date") || "");
    const date = parseInputDate(dateInput);
    
    const client = safeTrim(fd.get("client"));
    const eventName = safeTrim(fd.get("eventName"));
    const eventDetail = safeTrim(fd.get("eventDetail"));
    const krwIncome = toFloat(fd.get("krwIncome"));
    const krwExpense = toFloat(fd.get("krwExpense"));
    const bbIncome = toFloat(fd.get("bbIncome"));
    const bbExpense = toFloat(fd.get("bbExpense"));
    const kbIncome = toFloat(fd.get("kbIncome"));
    const kbExpense = toFloat(fd.get("kbExpense"));
    const usdIncome = toFloat(fd.get("usdIncome"));
    const usdExpense = toFloat(fd.get("usdExpense"));
    const memo = safeTrim(fd.get("memo"));

    if (!date) return;

    const entry = {
      id: makeId(),
      date,
      client,
      eventName,
      eventDetail,
      krwIncome,
      krwExpense,
      bbIncome,
      bbExpense,
      kbIncome,
      kbExpense,
      usdIncome,
      usdExpense,
      memo,
      createdAt: Date.now(),
    };

    entries = [entry, ...entries];
    saveEntries(entries);
    
    // 행사명과 거래처가 모두 있는 경우만 정산서 생성 (월별로 분리)
    if (eventName && client) {
      const ym = getYearMonth(date);
      ensureReportDefaults(safeEventKey(entry.eventName, ym), entry.eventName);
    }
    
    rerenderAllPreserveFocus();
    form.reset();
    
    // 기본값 유지
    for (const field of ["krwIncome", "krwExpense", "bbIncome", "bbExpense", "kbIncome", "kbExpense", "usdIncome", "usdExpense"]) {
      form.querySelector(`input[name="${field}"]`).value = "0";
    }
  });

  $("btnResetForm").addEventListener("click", () => {
    form.reset();
    for (const field of ["krwIncome", "krwExpense", "bbIncome", "bbExpense", "kbIncome", "kbExpense", "usdIncome", "usdExpense"]) {
      form.querySelector(`input[name="${field}"]`).value = "0";
    }
  });

  // 입력/저장 CSV 내보내기
  $("btnExportEntryCsv").addEventListener("click", () => {
    exportEntryCsv(entries);
  });

  // 삭제 버튼
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

  // 행사 목록 클릭
  $("eventList").addEventListener("click", (ev) => {
    const el = ev.target instanceof HTMLElement ? ev.target.closest("[data-key]") : null;
    if (!el) return;
    const key = el.dataset.key;
    if (!key) return;
    selectedEventKey = key;
    rerenderAllPreserveFocus();
  });

  // 정산서 입력값 변경 - input 대신 blur 사용
  const bindReportNumberInput = (id, field) => {
    $(id).addEventListener("blur", () => {
      if (!selectedEventKey) return;
      updateReportField(selectedEventKey, { [field]: toFloat($(id).value) });
      rerenderAllPreserveFocus();
    });
  };
  
  // 입금 필드
  bindReportNumberInput("reportFixedPriceKRWIncome", "fixedPriceKRWIncome");
  bindReportNumberInput("reportBahtExchangeRateIncome", "bahtExchangeRateIncome");
  bindReportNumberInput("reportFixedPriceBahtIncome", "fixedPriceBahtIncome");
  
  // 지출 필드
  bindReportNumberInput("reportFixedPriceKRWExpense", "fixedPriceKRWExpense");
  bindReportNumberInput("reportBahtExchangeRateExpense", "bahtExchangeRateExpense");
  bindReportNumberInput("reportFixedPriceBahtExpense", "fixedPriceBahtExpense");
  
  // 환율 변경 시 바트 확정가 자동 계산 및 저장 (곱하기)
  $("reportBahtExchangeRateIncome").addEventListener("blur", () => {
    if (!selectedEventKey) return;
    const krwIncome = toFloat($("reportFixedPriceKRWIncome").value);
    const rate = toFloat($("reportBahtExchangeRateIncome").value);
    if (rate > 0 && krwIncome > 0) {
      const calculated = krwIncome * rate; // 곱하기
      updateReportField(selectedEventKey, { 
        bahtExchangeRateIncome: rate,
        fixedPriceBahtIncome: calculated 
      });
      rerenderAllPreserveFocus();
    }
  });
  
  $("reportBahtExchangeRateExpense").addEventListener("blur", () => {
    if (!selectedEventKey) return;
    const krwExpense = toFloat($("reportFixedPriceKRWExpense").value);
    const rate = toFloat($("reportBahtExchangeRateExpense").value);
    if (rate > 0 && krwExpense > 0) {
      const calculated = krwExpense * rate; // 곱하기
      updateReportField(selectedEventKey, { 
        bahtExchangeRateExpense: rate,
        fixedPriceBahtExpense: calculated 
      });
      rerenderAllPreserveFocus();
    }
  });
  
  // 가이드 정산 입력값
  bindReportNumberInput("reportTourFee", "tourFee");
  bindReportNumberInput("reportOptionSales", "optionSales");
  bindReportNumberInput("reportOtherIncome", "otherIncome");
  bindReportNumberInput("reportEventCost", "eventCost");
  bindReportNumberInput("reportOptionCost", "optionCost");
  bindReportNumberInput("reportGuideDailyFee", "guideDailyFee");
  bindReportNumberInput("reportGuideCommission", "guideCommission");
  bindReportNumberInput("reportOtherPayment", "otherPayment");

  // 추가 항목 버튼
  $("btnAddAdditionalItem").addEventListener("click", () => {
    if (!selectedEventKey) return;
    const r = reportMap[selectedEventKey];
    if (!r.additionalItems) r.additionalItems = [];
    r.additionalItems.push({
      id: makeId(),
      name: "",
      income: 0,
      expense: 0,
    });
    saveReportMap(reportMap);
    rerenderAllPreserveFocus();
  });

  // 추가 항목 테이블 이벤트
  $("additionalItemsTable").addEventListener("input", (ev) => {
    const el = ev.target instanceof HTMLElement ? ev.target : null;
    if (!el || !selectedEventKey) return;
    
    const action = el.dataset.action;
    const id = el.dataset.id;
    if (!action || !id) return;
    
    const r = reportMap[selectedEventKey];
    if (!r || !r.additionalItems) return;
    
    const item = r.additionalItems.find(i => i.id === id);
    if (!item) return;
    
    if (action === "additional-item-name") item.name = el.value;
    if (action === "additional-item-income") item.income = toFloat(el.value);
    if (action === "additional-item-expense") item.expense = toFloat(el.value);
  });

  $("additionalItemsTable").addEventListener("blur", (ev) => {
    const el = ev.target instanceof HTMLElement ? ev.target : null;
    if (!el || !selectedEventKey) return;
    
    const action = el.dataset.action;
    if (action && action.startsWith("additional-item-")) {
      saveReportMap(reportMap);
      rerenderAllPreserveFocus();
    }
  }, true);

  $("additionalItemsTable").addEventListener("click", (ev) => {
    const btn = ev.target instanceof HTMLElement ? ev.target.closest("button") : null;
    if (!btn || !selectedEventKey) return;
    if (btn.dataset.action !== "additional-item-delete") return;
    
    const id = btn.dataset.id;
    if (!id) return;
    
    const r = reportMap[selectedEventKey];
    if (!r || !r.additionalItems) return;
    
    r.additionalItems = r.additionalItems.filter(i => i.id !== id);
    saveReportMap(reportMap);
    rerenderAllPreserveFocus();
  });

  // 가이드 옵션 추가
  $("btnAddGuideOption").addEventListener("click", () => {
    if (!selectedEventKey) return;
    const r = reportMap[selectedEventKey];
    if (!r.guideOptions) r.guideOptions = [];
    r.guideOptions.push({
      id: makeId(),
      optionName: "",
      salePrice: 0,
      costPrice: 0,
      vendor: "",
    });
    saveReportMap(reportMap);
    rerenderAllPreserveFocus();
  });

  // 가이드 옵션 테이블 이벤트 - 모든 필드를 blur로 저장
  $("guideOptionsTable").addEventListener("input", (ev) => {
    const el = ev.target instanceof HTMLElement ? ev.target : null;
    if (!el || !selectedEventKey) return;
    
    const action = el.dataset.action;
    const id = el.dataset.id;
    if (!action || !id) return;
    
    const r = reportMap[selectedEventKey];
    if (!r || !r.guideOptions) return;
    
    const opt = r.guideOptions.find(o => o.id === id);
    if (!opt) return;
    
    // 값만 업데이트, 저장/리렌더링 안함
    if (action === "guide-option-name") opt.optionName = el.value;
    if (action === "guide-option-sale") opt.salePrice = toFloat(el.value);
    if (action === "guide-option-cost") opt.costPrice = toFloat(el.value);
    if (action === "guide-option-vendor") opt.vendor = el.value;
  });

  // blur 시 저장
  $("guideOptionsTable").addEventListener("blur", (ev) => {
    const el = ev.target instanceof HTMLElement ? ev.target : null;
    if (!el || !selectedEventKey) return;
    
    const action = el.dataset.action;
    if (action && action.startsWith("guide-option-")) {
      saveReportMap(reportMap);
      rerenderAllPreserveFocus();
    }
  }, true);

  $("guideOptionsTable").addEventListener("click", (ev) => {
    const btn = ev.target instanceof HTMLElement ? ev.target.closest("button") : null;
    if (!btn || !selectedEventKey) return;
    if (btn.dataset.action !== "guide-option-delete") return;
    
    const id = btn.dataset.id;
    if (!id) return;
    
    const r = reportMap[selectedEventKey];
    if (!r || !r.guideOptions) return;
    
    r.guideOptions = r.guideOptions.filter(o => o.id !== id);
    saveReportMap(reportMap);
    rerenderAllPreserveFocus();
  });

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
      "원화 확정가(입금)",
      "바트환산(입금)",
      "바트 확정가(입금)",
      "원화 확정가(지출)",
      "바트환산(지출)",
      "바트 확정가(지출)",
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
      String(toFloat(r.fixedPriceKRWIncome)),
      String(toFloat(r.bahtExchangeRateIncome)),
      String(toFloat(r.fixedPriceBahtIncome)),
      String(toFloat(r.fixedPriceKRWExpense)),
      String(toFloat(r.bahtExchangeRateExpense)),
      String(toFloat(r.fixedPriceBahtExpense)),
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

    const rows = [];
    
    // 거래 내역
    const sorted = list
      .slice()
      .sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
    
    const bahtIncomeFixed = toFloat(r.fixedPriceBahtIncome);
    const bahtExpenseFixed = toFloat(r.fixedPriceBahtExpense);
    
    for (const e of sorted) {
      const itemIncome = bahtIncomeFixed + (e.bbIncome || 0) + (e.kbIncome || 0);
      const itemExpense = bahtExpenseFixed + (e.bbExpense || 0) + (e.kbExpense || 0);
      
      rows.push([
        "", "", "", "", "", "", "", "", "", "", "",
        e.date,
        e.client,
        e.eventDetail,
        String(itemIncome),
        String(itemExpense),
        e.memo
      ]);
    }
    
    // 추가 항목
    if (r.additionalItems && r.additionalItems.length > 0) {
      rows.push(["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
      rows.push(["", "", "", "", "", "", "", "", "", "", "", "추가 항목", "", "", "", "", ""]);
      
      for (const item of r.additionalItems) {
        rows.push([
          "", "", "", "", "", "", "", "", "", "", "",
          "",
          item.name || "",
          "",
          String(toFloat(item.income)),
          String(toFloat(item.expense)),
          ""
        ]);
      }
    }

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
    exportProfitCsv();
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

  // 수익 탭 이벤트
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
    
    // 값만 임시 저장 (리렌더링 안함)
    profitState.incomes[key].amountOverride = toFloat(el.value);
  });

  $("profitIncomeTable").addEventListener("blur", (ev) => {
    const el = ev.target instanceof HTMLElement ? ev.target : null;
    if (!el) return;
    const action = el.dataset.action;
    if (action === "income-amount") {
      saveProfitState(profitState);
      rerenderAllPreserveFocus();
    }
  }, true);

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

  // 지출 입력 이벤트 수정 (한글 입력 오류 해결)
  $("profitExpenseTable").addEventListener("input", (ev) => {
    const el = ev.target instanceof HTMLElement ? ev.target : null;
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;
    if (!action || !id) return;
    
    const idx = profitState.expenses.findIndex((e) => e.id === id);
    if (idx < 0) return;
    
    if (action === "expense-label") {
      profitState.expenses[idx].label = el.value;
    }
    if (action === "expense-amount") {
      profitState.expenses[idx].amount = toFloat(el.value);
    }
    
    // 즉시 저장하지 않음
  });

  // 지출 필드에서 포커스 아웃 시에만 저장
  $("profitExpenseTable").addEventListener("blur", (ev) => {
    const el = ev.target instanceof HTMLElement ? ev.target : null;
    if (!el) return;
    const action = el.dataset.action;
    if (action === "expense-label" || action === "expense-amount") {
      saveProfitState(profitState);
      rerenderAllPreserveFocus();
    }
  }, true);

  // 최초 렌더
  rerenderAll();
}

init();
