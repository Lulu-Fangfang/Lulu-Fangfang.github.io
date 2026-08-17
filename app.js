const STORAGE_KEY = "lulu-fangfang-house-data-v1";
const SESSION_KEY = "lulu-fangfang-admin-session";
const PASSWORD_HASH_KEY = "lulu-fangfang-admin-hash";
const DEFAULT_PASSWORD_HASH = "2b018aacf75143f372f5a727cc1bec4e457622ed6ebca962a0b8899a6e514ffd";
const DEFAULT_PASSWORD_FALLBACK_HASH = "7d534d8897d187792c5a3478882d9115";

const defaultData = {
  settings: {
    threshold: 3,
    periodStart: "2026-08-01",
    agreement: "先修复，再兑换。双方都舒服的时候，心愿才算真正兑现。",
  },
  records: [],
  wishes: [
    { id: "wish-1", title: "她挑的一餐，我全程安排", choice: "", redeemedAt: "", completedAt: "", status: "待选择" },
    { id: "wish-2", title: "全程承担家务半天", choice: "", redeemedAt: "", completedAt: "", status: "待选择" },
    { id: "wish-3", title: "肩颈放松 20 分钟", choice: "", redeemedAt: "", completedAt: "", status: "待选择" },
    { id: "wish-4", title: "陪她安排一项喜欢的活动", choice: "", redeemedAt: "", completedAt: "", status: "待选择" },
    { id: "wish-5", title: "她自定义：", choice: "", redeemedAt: "", completedAt: "", status: "待选择" },
  ],
};

let data = loadData();
let isAdmin = sessionStorage.getItem(SESSION_KEY) === "1";
let activeView = location.hash.replace("#", "") || "overview";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const today = () => new Date().toISOString().slice(0, 10);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return clone(defaultData);
    return {
      settings: { ...defaultData.settings, ...(saved.settings || {}) },
      records: Array.isArray(saved.records) ? saved.records : [],
      wishes: Array.isArray(saved.wishes) && saved.wishes.length ? saved.wishes : clone(defaultData.wishes),
    };
  } catch {
    return clone(defaultData);
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
  const threshold = Math.max(1, Number(data.settings.threshold) || 1);
  const remainder = cycleRecords.length % threshold;
  return {
    cycleRecords,
    threshold,
    available: Math.floor(cycleRecords.length / threshold),
    pending: cycleRecords.filter((record) => record.confirmation !== "已确认").length,
    completed: data.wishes.filter((wish) => wish.status === "已完成").length,
    registeredWishes: data.wishes.filter((wish) => wish.status !== "待选择").length,
    remainder,
    distance: cycleRecords.length === 0 ? threshold : remainder === 0 ? 0 : threshold - remainder,
    progress: cycleRecords.length === 0 ? 0 : remainder === 0 ? 100 : (remainder / threshold) * 100,
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
  $("#progressKicker").textContent = `${m.remainder} / ${m.threshold}`;
  $("#progressHeadline").textContent = m.distance === 0 ? "可以选择一份心愿" : `还差 ${m.distance} 次记录`;
  $("#progressSubline").textContent = m.distance === 0 ? "去心愿清单看看，她想要哪一项。" : "完成一次修复，就离心愿更近一点。";
  $("#progressBar").style.width = `${m.progress}%`;
  $("#progressStart").textContent = `本周期起点 ${formatDate(data.settings.periodStart)}`;
  $("#progressHint").textContent = m.distance === 0 ? "本轮已达成" : "继续把话说好";
  $("#recordsCount").textContent = data.records.length;
  $("#cycleRecordsCount").textContent = m.cycleRecords.length;
  $("#agreementNote").textContent = data.settings.agreement;
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
  target.innerHTML = data.wishes.slice(0, 4).map((wish) => `<div class="wish-preview-item"><span class="wish-bullet"><i data-lucide="sparkles"></i></span><strong>${escapeHtml(wish.title)}</strong><small>${escapeHtml(wish.status)}</small></div>`).join("");
}

function renderRecords() {
  const target = $("#recordsTable");
  if (!data.records.length) {
    target.innerHTML = `<div class="empty-state"><i data-lucide="notebook-pen"></i><strong>还没有记录</strong><span>管理员解锁后，可以新增第一次沟通复盘。</span></div>`;
    return;
  }
  const header = `<div class="record-row record-header"><div class="record-cell">日期</div><div class="record-cell">发生情境</div><div class="record-cell">我的语气</div><div class="record-cell">修复行动</div><div class="record-cell">她的确认</div><div class="record-cell">操作</div></div>`;
  const rows = [...data.records].sort((a, b) => b.date.localeCompare(a.date)).map((record) => `<div class="record-row"><div class="record-cell record-date" data-label="日期">${formatDate(record.date)}</div><div class="record-cell situation" data-label="情境"><strong>${escapeHtml(record.situation)}</strong><small>${escapeHtml(record.notes || "")}</small></div><div class="record-cell" data-label="语气"><span class="status-label">${escapeHtml(record.tone)}</span></div><div class="record-cell repair" data-label="修复行动"><small>${escapeHtml(record.repair)}</small></div><div class="record-cell" data-label="确认"><span class="status-label ${statusClass(record.confirmation)}">${escapeHtml(record.confirmation)}</span></div><div class="record-cell action-cell" data-label="操作">${isAdmin ? `<div class="row-actions"><button class="icon-button" data-action="edit-record" data-id="${record.id}" title="编辑记录"><i data-lucide="pencil"></i></button><button class="icon-button danger" data-action="delete-record" data-id="${record.id}" title="删除记录"><i data-lucide="trash-2"></i></button></div>` : `<span class="status-label">只读</span>`}</div></div>`).join("");
  target.innerHTML = header + rows;
}

function renderWishes() {
  const target = $("#wishGrid");
  target.innerHTML = data.wishes.map((wish, index) => `<article class="wish-card ${wish.status === "已完成" ? "is-done" : ""}"><div class="wish-card-top"><span class="wish-number">0${index + 1}</span><span class="status-label ${statusClass(wish.status)}">${escapeHtml(wish.status)}</span></div><h3>${escapeHtml(wish.title)}</h3><div class="wish-card-meta">${wish.choice ? `<span><i data-lucide="heart"></i>她的选择：${escapeHtml(wish.choice)}</span>` : `<span><i data-lucide="circle-dashed"></i>等待她选择</span>`}${wish.redeemedAt ? `<span><i data-lucide="calendar-days"></i>兑换于 ${formatDate(wish.redeemedAt)}</span>` : ""}${wish.completedAt ? `<span><i data-lucide="check"></i>完成于 ${formatDate(wish.completedAt)}</span>` : ""}</div><div class="wish-card-actions"><span class="eyebrow">WISH ${index + 1}</span>${isAdmin ? `<div class="row-actions"><button class="icon-button" data-action="edit-wish" data-id="${wish.id}" title="编辑心愿"><i data-lucide="pencil"></i></button><button class="icon-button danger" data-action="delete-wish" data-id="${wish.id}" title="删除心愿"><i data-lucide="trash-2"></i></button></div>` : `<span class="status-label">管理员可编辑</span>`}</div></article>`).join("");
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
  $("#privacyText").textContent = isAdmin ? "管理员已解锁" : "本地私密模式";
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
  sessionStorage.setItem(SESSION_KEY, "1");
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
  $("#wishChoice").value = wish?.choice || "待选择";
  $("#wishStatus").value = wish?.status || "待选择";
  $("#wishRedeemedAt").value = wish?.redeemedAt || "";
  $("#wishCompletedAt").value = wish?.completedAt || "";
  openModal("wishModal");
}

function exportBackup() {
  if (!requireAdmin("导出备份")) return;
  const payload = { exportedAt: new Date().toISOString(), app: "lulu-fangfang-house", data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `lulu-fangfang-backup-${today()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("备份已下载");
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
      data = { settings: { ...defaultData.settings, ...incoming.settings }, records: incoming.records, wishes: incoming.wishes };
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
  if (action === "delete-wish" && requireAdmin("删除心愿") && confirm("确定删除这份心愿吗？")) {
    data.wishes = data.wishes.filter((wish) => wish.id !== actionElement.dataset.id);
    saveData(); render(); toast("心愿已删除");
  }
  if (action === "export") exportBackup();
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
  const wish = { id, title: $("#wishTitle").value.trim(), choice: $("#wishChoice").value === "待选择" ? "" : $("#wishChoice").value, status: $("#wishStatus").value, redeemedAt: $("#wishRedeemedAt").value, completedAt: $("#wishCompletedAt").value };
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

window.addEventListener("hashchange", () => { activeView = location.hash.replace("#", "") || "overview"; renderView(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") $$(".modal-backdrop:not([hidden])").forEach((modal) => { modal.hidden = true; });
});

$("#todayLabel").textContent = formatDate(today());
render();
