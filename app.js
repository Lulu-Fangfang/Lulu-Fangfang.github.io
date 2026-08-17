const STORAGE_KEY = "lulu-fangfang-house-data-v1";
const SESSION_KEY = "lulu-fangfang-admin-session";
const PASSWORD_HASH_KEY = "lulu-fangfang-admin-hash";
const DATA_VERSION = 2;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_PASSWORD_HASH = "2b018aacf75143f372f5a727cc1bec4e457622ed6ebca962a0b8899a6e514ffd";
const DEFAULT_PASSWORD_FALLBACK_HASH = "7d534d8897d187792c5a3478882d9115";

const defaultData = {
  version: DATA_VERSION,
  settings: {
    threshold: 3,
    periodStart: "2026-08-01",
    agreement: "先修复，再兑换。双方都舒服的时候，心愿才算真正兑现。",
  },
  records: [],
  wishes: [
    { id: "wish-1", title: "她挑的一餐，我全程安排", description: "选餐厅、订位和行程都由我负责。" },
    { id: "wish-2", title: "全程承担家务半天", description: "让她安心休息，家里事务由我完成。" },
    { id: "wish-3", title: "肩颈放松 20 分钟", description: "以她舒服为准，随时可以暂停。" },
    { id: "wish-4", title: "陪她安排一项喜欢的活动", description: "由她决定内容和时间。" },
    { id: "wish-5", title: "她自定义一份心愿", description: "双方确认内容后再登记兑换。" },
  ],
  redemptions: [],
};

let data = loadData();
let isAdmin = restoreAdminSession();
let activeView = location.hash.replace("#", "") || "overview";
const recordFilters = { query: "", status: "all", cycleOnly: false };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeData(saved) {
  if (!saved) return clone(defaultData);
  const wishes = Array.isArray(saved.wishes) && saved.wishes.length
    ? saved.wishes.map((wish) => ({ ...wish, description: wish.description || "" }))
    : clone(defaultData.wishes);
  const migratedRedemptions = Array.isArray(saved.redemptions)
    ? saved.redemptions
    : wishes.filter((wish) => wish.redeemedAt).map((wish, index) => ({
      id: `migrated-redemption-${index}-${wish.id}`,
      wishId: wish.id,
      wishTitle: wish.title,
      redeemedAt: wish.redeemedAt,
      completedAt: wish.completedAt || "",
      status: wish.status === "已完成" ? "已完成" : "待完成",
    }));
  return {
    version: DATA_VERSION,
    settings: { ...defaultData.settings, ...(saved.settings || {}) },
    records: Array.isArray(saved.records) ? saved.records : [],
    wishes,
    redemptions: migratedRedemptions,
  };
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const normalized = normalizeData(saved);
    if (saved && saved.version !== DATA_VERSION) localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return clone(defaultData);
  }
}

function saveData() {
  data.version = DATA_VERSION;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function restoreAdminSession() {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (!saved) return false;
  if (saved === "1") {
    sessionStorage.setItem(SESSION_KEY, String(Date.now()));
    return true;
  }
  const lastActive = Number(saved);
  if (!Number.isFinite(lastActive) || Date.now() - lastActive > SESSION_TIMEOUT_MS) {
    sessionStorage.removeItem(SESSION_KEY);
    return false;
  }
  return true;
}

function touchAdminSession() {
  if (isAdmin) sessionStorage.setItem(SESSION_KEY, String(Date.now()));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function formatDate(value, compact = false) {
  if (!value) return "未填写";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  if (compact) return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isInCycle(record) {
  return record.date >= data.settings.periodStart && record.date <= today();
}

function metrics() {
  const cycleRecords = data.records.filter(isInCycle);
  const cycleRedemptions = data.redemptions.filter((item) => item.redeemedAt >= data.settings.periodStart && item.redeemedAt <= today());
  const threshold = Math.max(1, Number(data.settings.threshold) || 1);
  const remainder = cycleRecords.length % threshold;
  const earned = Math.floor(cycleRecords.length / threshold);
  const used = cycleRedemptions.length;
  const available = Math.max(0, earned - used);
  return {
    cycleRecords,
    cycleRedemptions,
    threshold,
    earned,
    used,
    available,
    pending: cycleRecords.filter((record) => record.confirmation !== "已确认").length,
    completed: data.redemptions.filter((item) => item.status === "已完成").length,
    registeredWishes: data.redemptions.length,
    remainder,
    distance: available > 0 ? 0 : remainder === 0 ? threshold : threshold - remainder,
    progress: available > 0 ? 100 : (remainder / threshold) * 100,
  };
}

function statusClass(status) {
  if (status === "已确认" || status === "已完成") return "confirmed";
  if (status === "需要再沟通" || status === "调整") return "needs";
  return "";
}

function renderStats() {
  const m = metrics();
  $("#statRecords").textContent = m.cycleRecords.length;
  $("#statAvailable").textContent = m.available;
  $("#statPending").textContent = m.pending;
  $("#statCompleted").textContent = m.completed;
  $("#statPeriod").textContent = `从 ${formatDate(data.settings.periodStart)} 开始`;
  $("#statThreshold").textContent = `每 ${m.threshold} 次记录兑换 1 份`;
  $("#progressKicker").textContent = m.available > 0 ? `${m.available} 份可用` : `${m.remainder} / ${m.threshold}`;
  $("#progressHeadline").textContent = m.available > 0 ? "可以选择一份心愿" : `还差 ${m.distance} 次记录`;
  $("#progressSubline").textContent = m.available > 0 ? "去心愿清单看看，她想要哪一项。" : "完成一次修复，就离心愿更近一点。";
  $("#progressBar").style.width = `${m.progress}%`;
  $("#progressStart").textContent = `本周期起点 ${formatDate(data.settings.periodStart)}`;
  $("#progressHint").textContent = m.available > 0 ? "本轮已达成" : "继续把话说好";
  $("#earnedCount").textContent = m.earned;
  $("#usedCount").textContent = m.used;
  $("#balanceCount").textContent = m.available;
  $("#wishBalanceCount").textContent = m.available;
  $("#recordsCount").textContent = data.records.length;
  $("#cycleRecordsCount").textContent = m.cycleRecords.length;
  $("#agreementNote").textContent = data.settings.agreement;
  renderWeekTrend();
}

function renderWeekTrend() {
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    days.push({ key, label: ["日", "一", "二", "三", "四", "五", "六"][date.getDay()], count: data.records.filter((record) => record.date === key).length });
  }
  const max = Math.max(1, ...days.map((day) => day.count));
  $("#weekRecordCount").textContent = `${days.reduce((sum, day) => sum + day.count, 0)} 次`;
  $("#weekTrend").innerHTML = days.map((day) => {
    const height = day.count ? Math.max(14, Math.round((day.count / max) * 48)) : 3;
    return `<div class="trend-day ${day.count ? "has-records" : ""}" title="${formatDate(day.key)}：${day.count} 次"><div class="trend-bar-track"><span class="trend-bar" style="height:${height}px"></span></div><span>${day.label}</span></div>`;
  }).join("");
}

function renderRecentRecords() {
  const target = $("#recentRecords");
  const recent = [...data.records].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  if (!recent.length) {
    target.innerHTML = `<div class="empty-state"><i data-lucide="notebook-pen"></i><strong>还没有复盘记录</strong><span>解锁管理员模式后，从这里开始新增。</span></div>`;
    return;
  }
  target.innerHTML = recent.map((record) => `<div class="activity-item"><div class="activity-date">${formatDate(record.date, true).replace("/", "<br />")}</div><div><strong>${escapeHtml(record.situation)}</strong><small>${escapeHtml(record.repair)}</small></div><span class="status-label ${statusClass(record.confirmation)}">${escapeHtml(record.confirmation)}</span></div>`).join("");
}

function renderWishPreview() {
  const target = $("#wishPreview");
  target.innerHTML = data.wishes.slice(0, 4).map((wish) => {
    const count = data.redemptions.filter((item) => item.wishId === wish.id).length;
    return `<div class="wish-preview-item"><span class="wish-bullet"><i data-lucide="sparkles"></i></span><strong>${escapeHtml(wish.title)}</strong><small>${count ? `已兑换 ${count} 次` : "等待选择"}</small></div>`;
  }).join("");
}

function renderRecords() {
  const target = $("#recordsTable");
  const query = recordFilters.query.toLowerCase();
  const filtered = [...data.records]
    .filter((record) => !recordFilters.cycleOnly || isInCycle(record))
    .filter((record) => recordFilters.status === "all" || record.confirmation === recordFilters.status)
    .filter((record) => !query || [record.situation, record.tone, record.repair, record.notes, record.confirmation].some((value) => String(value || "").toLowerCase().includes(query)))
    .sort((a, b) => b.date.localeCompare(a.date));
  $("#recordResultCount").textContent = filtered.length;
  if (!filtered.length) {
    const hasFilters = recordFilters.query || recordFilters.status !== "all" || recordFilters.cycleOnly;
    target.innerHTML = `<div class="empty-state"><i data-lucide="${hasFilters ? "search-x" : "notebook-pen"}"></i><strong>${hasFilters ? "没有符合条件的记录" : "还没有记录"}</strong><span>${hasFilters ? "调整搜索词或筛选条件后再试。" : "管理员解锁后，可以新增第一次沟通复盘。"}</span></div>`;
    return;
  }
  const header = `<div class="record-row record-header"><div class="record-cell">日期</div><div class="record-cell">发生情境</div><div class="record-cell">我的语气</div><div class="record-cell">修复行动</div><div class="record-cell">她的确认</div><div class="record-cell">操作</div></div>`;
  const rows = filtered.map((record) => `<div class="record-row"><div class="record-cell record-date" data-label="日期">${formatDate(record.date)}</div><div class="record-cell situation" data-label="情境"><strong>${escapeHtml(record.situation)}</strong><small>${escapeHtml(record.notes || "")}</small></div><div class="record-cell" data-label="语气"><span class="status-label">${escapeHtml(record.tone)}</span></div><div class="record-cell repair" data-label="修复行动"><small>${escapeHtml(record.repair)}</small></div><div class="record-cell" data-label="确认"><span class="status-label ${statusClass(record.confirmation)}">${escapeHtml(record.confirmation)}</span></div><div class="record-cell action-cell" data-label="操作">${isAdmin ? `<div class="row-actions"><button class="icon-button" data-action="edit-record" data-id="${record.id}" title="编辑记录"><i data-lucide="pencil"></i></button><button class="icon-button danger" data-action="delete-record" data-id="${record.id}" title="删除记录"><i data-lucide="trash-2"></i></button></div>` : `<span class="status-label">只读</span>`}</div></div>`).join("");
  target.innerHTML = header + rows;
}

function renderWishes() {
  const target = $("#wishGrid");
  const m = metrics();
  target.innerHTML = data.wishes.map((wish, index) => {
    const related = data.redemptions.filter((item) => item.wishId === wish.id).sort((a, b) => b.redeemedAt.localeCompare(a.redeemedAt));
    const latest = related[0];
    return `<article class="wish-card ${latest?.status === "已完成" ? "is-done" : ""}"><div class="wish-card-top"><span class="wish-number">${String(index + 1).padStart(2, "0")}</span><span class="status-label ${latest ? statusClass(latest.status) : ""}">${related.length ? `兑换 ${related.length} 次` : "可选心愿"}</span></div><h3>${escapeHtml(wish.title)}</h3>${wish.description ? `<p class="wish-card-description">${escapeHtml(wish.description)}</p>` : ""}<div class="wish-card-meta">${latest ? `<span><i data-lucide="calendar-days"></i>最近兑换：${formatDate(latest.redeemedAt)}</span><span><i data-lucide="${latest.status === "已完成" ? "check" : "clock-3"}"></i>${escapeHtml(latest.status)}</span>` : `<span><i data-lucide="circle-dashed"></i>还没有兑换记录</span>`}</div><div class="wish-card-actions"><button class="button button-primary wish-redeem-button" data-action="redeem-wish" data-id="${wish.id}" type="button" ${isAdmin && m.available < 1 ? "disabled" : ""}><i data-lucide="ticket-check"></i>${isAdmin ? "兑换" : "登录兑换"}</button>${isAdmin ? `<div class="row-actions"><button class="icon-button" data-action="edit-wish" data-id="${wish.id}" title="编辑心愿"><i data-lucide="pencil"></i></button><button class="icon-button danger" data-action="delete-wish" data-id="${wish.id}" title="删除心愿"><i data-lucide="trash-2"></i></button></div>` : ""}</div></article>`;
  }).join("");
}

function renderRedemptions() {
  const target = $("#redemptionList");
  const sorted = [...data.redemptions].sort((a, b) => `${b.redeemedAt}-${b.id}`.localeCompare(`${a.redeemedAt}-${a.id}`));
  $("#redemptionSummary").textContent = sorted.length ? `共 ${sorted.length} 次 · 已完成 ${sorted.filter((item) => item.status === "已完成").length} 次` : "还没有兑换记录";
  if (!sorted.length) {
    target.innerHTML = `<div class="empty-state"><i data-lucide="ticket"></i><strong>还没有兑换流水</strong><span>达到兑换门槛后，从上方选择一份心愿。</span></div>`;
    return;
  }
  target.innerHTML = sorted.map((item, index) => `<div class="redemption-row"><span class="redemption-index">${String(index + 1).padStart(2, "0")}</span><div class="redemption-main"><strong>${escapeHtml(item.wishTitle)}</strong><small>${item.completedAt ? `完成于 ${formatDate(item.completedAt)}` : "等待完成确认"}</small></div><span class="redemption-date">兑换于 ${formatDate(item.redeemedAt)}</span><span class="status-label ${statusClass(item.status)}">${escapeHtml(item.status)}</span><div class="redemption-actions">${isAdmin && item.status !== "已完成" ? `<button class="button button-outline" data-action="complete-redemption" data-id="${item.id}" type="button"><i data-lucide="check"></i>确认完成</button>` : ""}${isAdmin ? `<button class="icon-button danger" data-action="delete-redemption" data-id="${item.id}" title="撤销这次兑换"><i data-lucide="undo-2"></i></button>` : ""}</div></div>`).join("");
}

function renderSettings() {
  $("#thresholdInput").value = data.settings.threshold;
  $("#periodStartInput").value = data.settings.periodStart;
  $("#agreementInput").value = data.settings.agreement;
  $("#adminStatus").textContent = isAdmin ? "管理员模式已解锁" : "访客模式";
  $("#adminStatus").classList.toggle("is-admin", isAdmin);
  const adminButton = $("#adminButton");
  adminButton.innerHTML = isAdmin
    ? '<i data-lucide="shield-check" aria-hidden="true"></i><span>管理中心</span>'
    : '<i data-lucide="lock-keyhole" aria-hidden="true"></i><span>管理员登录</span>';
  adminButton.classList.toggle("is-admin", isAdmin);
  adminButton.setAttribute("aria-label", isAdmin ? "管理员已解锁，进入管理中心" : "管理员登录");
  ["#thresholdInput", "#periodStartInput", "#agreementInput"].forEach((selector) => {
    $(selector).disabled = !isAdmin;
  });
  $$(".admin-only").forEach((element) => {
    if (element.closest("#settingsForm") || element.matches("input, select, textarea")) element.disabled = !isAdmin;
    else if (element.matches("button")) element.disabled = false;
    element.classList.toggle("is-hidden-for-guest", !isAdmin);
  });
  $("#privacyText").textContent = isAdmin ? "管理员已解锁 · 自动锁定" : "本地私密模式";
}

function renderView() {
  const validViews = ["overview", "records", "wishes", "settings"];
  if (!validViews.includes(activeView)) activeView = "overview";
  $$("[data-view-panel]").forEach((panel) => {
    const visible = panel.dataset.viewPanel === activeView;
    panel.hidden = !visible;
    panel.classList.toggle("is-visible", visible);
  });
  $$(".tab-button").forEach((button) => button.classList.toggle("is-active", button.dataset.view === activeView));
}

function render() {
  renderStats();
  renderRecentRecords();
  renderWishPreview();
  renderRecords();
  renderWishes();
  renderRedemptions();
  renderSettings();
  renderView();
  refreshIcons();
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function setView(view) {
  activeView = view;
  history.replaceState(null, "", `#${view}`);
  renderView();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  const firstInput = modal.querySelector("input:not([type=hidden]), textarea, select");
  if (firstInput) setTimeout(() => firstInput.focus(), 30);
  refreshIcons();
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = true;
}

function requireAdmin(action) {
  if (isAdmin) return true;
  openModal("authModal");
  toast(action ? `需要管理员解锁后才能${action}` : "需要管理员解锁");
  return false;
}

function toast(message) {
  const region = $("#toastRegion");
  region.replaceChildren();
  const item = document.createElement("div");
  item.className = "toast";
  item.innerHTML = `<i data-lucide="check-circle-2"></i><span>${escapeHtml(message)}</span>`;
  region.appendChild(item);
  refreshIcons();
  setTimeout(() => item.remove(), 3200);
}

function fallbackHash(value) {
  let a = 2166136261 >>> 0;
  let b = 374761393 >>> 0;
  let c = 668265263 >>> 0;
  let d = 2246822519 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ ((code + index) & 255), 2246822519);
    c = Math.imul(c ^ ((code << 8) | index), 3266489917);
    d = Math.imul(d ^ ((code * 31) + index), 668265263);
  }
  return [a, b, c, d].map((number) => (number >>> 0).toString(16).padStart(8, "0")).join("");
}

async function passwordRecord(value) {
  const fallback = `fallback:${fallbackHash(value)}`;
  if (!globalThis.crypto?.subtle) return fallback;
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const sha256 = [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${sha256}|${fallback}`;
}

function currentPasswordHash() {
  return localStorage.getItem(PASSWORD_HASH_KEY) || `sha256:${DEFAULT_PASSWORD_HASH}|fallback:${DEFAULT_PASSWORD_FALLBACK_HASH}`;
}

async function passwordMatches(value, stored) {
  const fallback = `fallback:${fallbackHash(value)}`;
  if (stored === fallback || stored.split("|").includes(fallback)) return true;
  if (!globalThis.crypto?.subtle) return false;
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const sha256 = [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return stored === sha256 || stored === `sha256:${sha256}` || stored.split("|").includes(`sha256:${sha256}`);
}

function unlock() {
  isAdmin = true;
  touchAdminSession();
  closeModal("authModal");
  $("#passwordInput").value = "";
  $("#authError").hidden = true;
  render();
  setView("settings");
  toast("管理员模式已解锁");
}

function resetLocalPassword() {
  localStorage.removeItem(PASSWORD_HASH_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  isAdmin = false;
  $("#passwordInput").value = "";
  $("#authError").hidden = true;
  render();
  toast("本机密码已重置，请使用初始密码登录");
  setTimeout(() => $("#passwordInput").focus(), 30);
}

function logout() {
  isAdmin = false;
  sessionStorage.removeItem(SESSION_KEY);
  render();
  toast("已退出管理员模式");
}

function checkAdminSession() {
  if (!isAdmin) return;
  const lastActive = Number(sessionStorage.getItem(SESSION_KEY));
  if (!Number.isFinite(lastActive) || Date.now() - lastActive > SESSION_TIMEOUT_MS) {
    isAdmin = false;
    sessionStorage.removeItem(SESSION_KEY);
    render();
    toast("管理员会话已自动锁定");
  }
}

function openRecordEditor(id = "") {
  if (!requireAdmin("编辑记录")) return;
  const record = data.records.find((item) => item.id === id);
  $("#recordModalTitle").textContent = record ? "编辑复盘记录" : "新增复盘记录";
  $("#recordId").value = record?.id || "";
  $("#recordDate").value = record?.date || today();
  $("#recordTone").value = record?.tone || "提高音量";
  $("#recordSituation").value = record?.situation || "";
  $("#recordRepair").value = record?.repair || "";
  $("#recordConfirmation").value = record?.confirmation || "待确认";
  $("#recordNotes").value = record?.notes || "";
  openModal("recordModal");
}

function openWishEditor(id = "") {
  if (!requireAdmin("编辑心愿")) return;
  const wish = data.wishes.find((item) => item.id === id);
  $("#wishModalTitle").textContent = wish ? "编辑心愿" : "新增心愿";
  $("#wishId").value = wish?.id || "";
  $("#wishTitle").value = wish?.title || "";
  $("#wishDescription").value = wish?.description || "";
  openModal("wishModal");
}

function redeemWish(id) {
  if (!requireAdmin("兑换心愿")) return;
  const wish = data.wishes.find((item) => item.id === id);
  const m = metrics();
  if (!wish || m.available < 1) {
    toast("当前没有可用的心愿余额");
    return;
  }
  if (!confirm(`确定兑换“${wish.title}”吗？这会使用 1 份心愿余额。`)) return;
  data.redemptions.push({ id: `redemption-${Date.now()}`, wishId: wish.id, wishTitle: wish.title, redeemedAt: today(), completedAt: "", status: "待完成" });
  saveData();
  render();
  toast("心愿已登记，记得完成后确认");
}

function completeRedemption(id) {
  if (!requireAdmin("确认兑换完成")) return;
  const item = data.redemptions.find((entry) => entry.id === id);
  if (!item) return;
  item.status = "已完成";
  item.completedAt = today();
  saveData();
  render();
  toast("这份心愿已确认完成");
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function exportBackup() {
  if (!requireAdmin("导出备份")) return;
  const payload = { version: DATA_VERSION, exportedAt: new Date().toISOString(), app: "lulu-fangfang-house", data };
  downloadText(`lulu-fangfang-backup-${today()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  toast("备份已下载");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportRecordsCsv() {
  if (!requireAdmin("导出记录")) return;
  const rows = [["日期", "发生情境", "我的语气", "修复行动", "她的确认", "备注"], ...[...data.records].sort((a, b) => b.date.localeCompare(a.date)).map((record) => [record.date, record.situation, record.tone, record.repair, record.confirmation, record.notes || ""])];
  downloadText(`沟通复盘记录-${today()}.csv`, `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`, "text/csv;charset=utf-8");
  toast("CSV 已下载");
}

function importBackup() {
  if (!requireAdmin("导入备份")) return;
  $("#importFile").click();
}

function handleImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incoming = parsed.data || parsed;
      if (!incoming || !Array.isArray(incoming.records) || !Array.isArray(incoming.wishes) || !incoming.settings) throw new Error("invalid");
      data = normalizeData(incoming);
      saveData();
      render();
      toast("备份已导入");
    } catch {
      toast("导入失败：文件格式不正确");
    }
  };
  reader.readAsText(file);
}

document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-view]");
  if (tab) setView(tab.dataset.view);
  const target = event.target.closest("[data-view-target]");
  if (target) setView(target.dataset.viewTarget);
  const close = event.target.closest("[data-close-modal]");
  if (close) closeModal(close.dataset.closeModal);
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  const action = actionElement.dataset.action;
  if (action === "new-record") openRecordEditor();
  if (action === "edit-record") openRecordEditor(actionElement.dataset.id);
  if (action === "delete-record" && requireAdmin("删除记录") && confirm("确定删除这条复盘记录吗？")) {
    data.records = data.records.filter((record) => record.id !== actionElement.dataset.id);
    saveData(); render(); toast("记录已删除");
  }
  if (action === "new-wish") openWishEditor();
  if (action === "edit-wish") openWishEditor(actionElement.dataset.id);
  if (action === "redeem-wish") redeemWish(actionElement.dataset.id);
  if (action === "delete-wish" && requireAdmin("删除心愿") && confirm("确定删除这份心愿吗？已有兑换流水会继续保留。")) {
    data.wishes = data.wishes.filter((wish) => wish.id !== actionElement.dataset.id);
    saveData(); render(); toast("心愿已删除");
  }
  if (action === "complete-redemption") completeRedemption(actionElement.dataset.id);
  if (action === "delete-redemption" && requireAdmin("撤销兑换") && confirm("确定撤销这次兑换吗？对应的 1 份心愿余额会恢复。")) {
    data.redemptions = data.redemptions.filter((item) => item.id !== actionElement.dataset.id);
    saveData(); render(); toast("兑换已撤销，余额已恢复");
  }
  if (action === "export") exportBackup();
  if (action === "export-csv") exportRecordsCsv();
  if (action === "import") importBackup();
  if (action === "logout") logout();
  if (action === "reset-password" && confirm("只重置当前浏览器的管理员密码，不会删除任何记录。确定继续吗？")) resetLocalPassword();
  if (action === "change-password" && requireAdmin("修改密码")) openModal("passwordModal");
});

$("#adminButton").addEventListener("click", () => isAdmin ? setView("settings") : openModal("authModal"));

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const matches = await passwordMatches($("#passwordInput").value, currentPasswordHash());
    if (!matches) {
      $("#authError").textContent = "密码不正确，请重试。";
      $("#authError").hidden = false;
      $("#passwordInput").select();
      return;
    }
  } catch {
    $("#authError").textContent = "当前浏览器无法完成密码校验，请改用 HTTPS 或本地服务器打开。";
    $("#authError").hidden = false;
    return;
  }
  unlock();
});

$("#recordForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireAdmin("保存记录")) return;
  const id = $("#recordId").value || `record-${Date.now()}`;
  const record = { id, date: $("#recordDate").value, tone: $("#recordTone").value, situation: $("#recordSituation").value.trim(), repair: $("#recordRepair").value.trim(), confirmation: $("#recordConfirmation").value, notes: $("#recordNotes").value.trim() };
  const existingIndex = data.records.findIndex((item) => item.id === id);
  if (existingIndex >= 0) data.records[existingIndex] = record;
  else data.records.push(record);
  saveData(); closeModal("recordModal"); render(); toast(existingIndex >= 0 ? "记录已更新" : "记录已保存");
});

$("#wishForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireAdmin("保存心愿")) return;
  const id = $("#wishId").value || `wish-${Date.now()}`;
  const wish = { id, title: $("#wishTitle").value.trim(), description: $("#wishDescription").value.trim() };
  const existingIndex = data.wishes.findIndex((item) => item.id === id);
  if (existingIndex >= 0) data.wishes[existingIndex] = wish;
  else data.wishes.push(wish);
  saveData(); closeModal("wishModal"); render(); toast(existingIndex >= 0 ? "心愿已更新" : "心愿已保存");
});

$("#settingsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireAdmin("保存规则")) return;
  data.settings.threshold = Math.max(1, Number($("#thresholdInput").value) || 1);
  data.settings.periodStart = $("#periodStartInput").value || today();
  data.settings.agreement = $("#agreementInput").value.trim() || defaultData.settings.agreement;
  saveData(); render(); toast("规则已保存");
});

$("#passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("#passwordError");
  if (!(await passwordMatches($("#currentPassword").value, currentPasswordHash()))) { error.textContent = "当前密码不正确。"; error.hidden = false; return; }
  if ($("#newPassword").value.length < 8) { error.textContent = "新密码至少需要 8 位。"; error.hidden = false; return; }
  if ($("#newPassword").value !== $("#confirmPassword").value) { error.textContent = "两次输入的新密码不一致。"; error.hidden = false; return; }
  localStorage.setItem(PASSWORD_HASH_KEY, await passwordRecord($("#newPassword").value));
  $("#passwordForm").reset(); error.hidden = true; closeModal("passwordModal"); toast("管理员密码已更新");
});

$("#importFile").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) handleImport(file);
  event.target.value = "";
});

$("#recordSearch").addEventListener("input", (event) => {
  recordFilters.query = event.target.value.trim();
  renderRecords();
  refreshIcons();
});

$("#recordStatusFilter").addEventListener("change", (event) => {
  recordFilters.status = event.target.value;
  renderRecords();
  refreshIcons();
});

$("#cycleOnlyFilter").addEventListener("change", (event) => {
  recordFilters.cycleOnly = event.target.checked;
  renderRecords();
  refreshIcons();
});

window.addEventListener("hashchange", () => { activeView = location.hash.replace("#", "") || "overview"; renderView(); });
document.addEventListener("pointerdown", touchAdminSession, { passive: true });
document.addEventListener("keydown", (event) => {
  touchAdminSession();
  if (event.key === "Escape") $$(".modal-backdrop:not([hidden])").forEach((modal) => { modal.hidden = true; });
});
setInterval(checkAdminSession, 60 * 1000);

$("#todayLabel").textContent = formatDate(today());
render();
