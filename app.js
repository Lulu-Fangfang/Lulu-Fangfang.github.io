const STORAGE_KEY = "lulu-fangfang-house-data-v1";
const PASSWORD_HASH_KEYS = {
  recorder: "lulu-fangfang-password-recorder",
  reviewer: "lulu-fangfang-password-reviewer",
};
const DATA_VERSION = 3;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_PASSWORD_HASHES = {
  recorder: { sha256: "9a0dd7ba868524e126086edda337dac92c8b4363a115edc709e8b3523a95a696", fallback: "5d45f3cfd18d6d87198fb2e795e11db1" },
  reviewer: { sha256: "d1228b0c90170b196f6955986a61382313cf9f1f4c6cd919177eea6e772ea9bc", fallback: "06607d4fd0331b79024198e717d3c5af" },
};

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
  moments: [],
  tasks: [],
  issues: [],
};

let data = loadData();
let currentRole = null;
let isAdmin = false;
let lastAdminActivity = 0;
let activeView = location.hash.replace("#", "") || "overview";
const recordFilters = { query: "", status: "all", cycleOnly: false };
let pendingMomentImages = [];
let editingMomentImageIds = [];
let originalMomentImageIds = [];
const imageCache = new Map();

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
    records: Array.isArray(saved.records) ? saved.records.map((record) => ({ confirmation: "待确认", notes: "", ...record })) : [],
    wishes,
    redemptions: migratedRedemptions,
    moments: Array.isArray(saved.moments) ? saved.moments.map((moment) => ({ imageIds: [], reviewStatus: "待复核", reviewedAt: "", ...moment })) : [],
    tasks: Array.isArray(saved.tasks) ? saved.tasks.map((task) => ({ ...task, done: Boolean(task.done), reviewed: Boolean(task.reviewed), reviewedAt: task.reviewedAt || "", createdAt: task.createdAt || `${task.date || "1970-01-01"}T00:00:00.000Z` })) : [],
    issues: Array.isArray(saved.issues) ? saved.issues.map((issue) => ({ status: "待沟通", reviewedAt: "", proposal: "", ...issue })) : [],
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

const MEDIA_DB_NAME = "lulu-fangfang-media-v1";
const MEDIA_STORE_NAME = "images";

function openMediaDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MEDIA_STORE_NAME)) request.result.createObjectStore(MEDIA_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function mediaTransaction(mode, handler) {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE_NAME, mode);
    const store = transaction.objectStore(MEDIA_STORE_NAME);
    const result = handler(store);
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

async function putMedia(item) {
  await mediaTransaction("readwrite", (store) => store.put(item));
  imageCache.set(item.id, item);
}

async function deleteMedia(id) {
  await mediaTransaction("readwrite", (store) => store.delete(id));
  imageCache.delete(id);
}

async function clearAllMedia() {
  await mediaTransaction("readwrite", (store) => store.clear());
  imageCache.clear();
}

async function getAllMedia() {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE_NAME, "readonly");
    const request = transaction.objectStore(MEDIA_STORE_NAME).getAll();
    request.onsuccess = () => { db.close(); resolve(request.result || []); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function hydrateMediaCache() {
  try {
    const items = await getAllMedia();
    imageCache.clear();
    items.forEach((item) => imageCache.set(item.id, item));
  } catch {
    toast("当前浏览器无法打开本地图片库");
  }
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  const source = await fileAsDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = reject;
    element.src = source;
  });
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", 0.82);
}

function touchAdminSession() {
  if (isAdmin) lastAdminActivity = Date.now();
}

const isRecorder = () => currentRole === "recorder";
const isReviewer = () => currentRole === "reviewer";

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
  if (["已确认", "已完成", "已复核", "已解决"].includes(status)) return "confirmed";
  if (["需要再沟通", "调整", "待沟通"].includes(status)) return "needs";
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
    target.innerHTML = `<div class="empty-state"><i data-lucide="notebook-pen"></i><strong>还没有复盘记录</strong><span>方方登录后，可以从这里开始记录。</span></div>`;
    return;
  }
  target.innerHTML = recent.map((record) => `<div class="activity-item"><div class="activity-date">${formatDate(record.date, true).replace("/", "<br />")}</div><div><strong>${escapeHtml(record.situation)}</strong><small>${escapeHtml(record.repair)}</small></div><span class="status-label ${statusClass(record.confirmation)}">${escapeHtml(record.confirmation)}</span></div>`).join("");
}

function renderMoments() {
  const target = $("#momentsGrid");
  const sorted = [...data.moments].sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`));
  if (!sorted.length) {
    target.innerHTML = `<div class="empty-state module-empty"><i data-lucide="images"></i><strong>还没有美好记录</strong><span>方方登录后，可以写下第一件值得记住的小事。</span></div>`;
    return;
  }
  target.innerHTML = sorted.map((moment) => {
    const images = (moment.imageIds || []).map((id) => imageCache.get(id)).filter(Boolean);
    const imageMarkup = images.length ? `<div class="moment-photo-grid count-${Math.min(images.length, 4)}">${images.map((image) => `<img src="${image.dataUrl}" alt="${escapeHtml(moment.title)}的照片" loading="lazy" />`).join("")}</div>` : `<div class="moment-no-photo"><i data-lucide="sun-medium"></i><span>${formatDate(moment.date, true)}</span></div>`;
    return `<article class="moment-card">${imageMarkup}<div class="moment-content"><div class="moment-meta"><span>${formatDate(moment.date)}</span><span class="status-label ${statusClass(moment.reviewStatus)}">${escapeHtml(moment.reviewStatus || "待复核")}</span></div><h3>${escapeHtml(moment.title)}</h3>${moment.note ? `<p>${escapeHtml(moment.note)}</p>` : ""}<div class="moment-actions">${isReviewer() && moment.reviewStatus !== "已复核" ? `<button class="button button-outline" data-action="review-moment" data-id="${moment.id}" type="button"><i data-lucide="badge-check"></i>确认复核</button>` : ""}${isRecorder() ? `<div class="row-actions"><button class="icon-button" data-action="edit-moment" data-id="${moment.id}" title="编辑美好记录"><i data-lucide="pencil"></i></button><button class="icon-button danger" data-action="delete-moment" data-id="${moment.id}" title="删除美好记录"><i data-lucide="trash-2"></i></button></div>` : ""}</div></div></article>`;
  }).join("");
}

function renderTasks() {
  const selectedDate = $("#taskDateFilter").value || today();
  const tasks = data.tasks.filter((task) => task.date === selectedDate).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const completed = tasks.filter((task) => task.done).length;
  const reviewed = tasks.filter((task) => task.reviewed).length;
  $("#taskProgressText").textContent = tasks.length ? `${completed}/${tasks.length} 已完成 · ${reviewed} 项已复核` : "这一天还没有任务";
  $("#taskProgressBar").style.width = `${tasks.length ? (completed / tasks.length) * 100 : 0}%`;
  const target = $("#taskList");
  if (!tasks.length) {
    target.innerHTML = `<div class="empty-state compact-empty"><i data-lucide="list-todo"></i><strong>清单还是空的</strong><span>方方可以添加当天要做的事情。</span></div>`;
    return;
  }
  target.innerHTML = tasks.map((task) => `<div class="task-row ${task.done ? "is-done" : ""} ${task.reviewed ? "is-reviewed" : ""}"><button class="task-check" data-action="toggle-task" data-id="${task.id}" type="button" ${!isRecorder() ? "disabled" : ""} aria-label="${task.done ? "标记为未完成" : "标记为已完成"}"><i data-lucide="${task.done ? "check" : "circle"}"></i></button><div class="task-main"><strong>${escapeHtml(task.title)}</strong><small>${task.reviewed ? `路路小皇帝已复核 · ${formatDate(task.reviewedAt)}` : task.done ? "等待路路小皇帝复核" : "等待方方完成"}</small></div><span class="status-label ${task.reviewed ? "confirmed" : ""}">${task.reviewed ? "已复核" : task.done ? "待复核" : "待完成"}</span><div class="task-actions">${isReviewer() && task.done && !task.reviewed ? `<button class="button button-outline" data-action="review-task" data-id="${task.id}" type="button"><i data-lucide="badge-check"></i>复核</button>` : ""}${isRecorder() ? `<button class="icon-button danger" data-action="delete-task" data-id="${task.id}" title="删除任务"><i data-lucide="trash-2"></i></button>` : ""}</div></div>`).join("");
}

function renderIssues() {
  const target = $("#issueGrid");
  const sorted = [...data.issues].sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`));
  const counts = { open: sorted.filter((item) => item.status !== "已解决").length, talking: sorted.filter((item) => item.status === "沟通中").length, solved: sorted.filter((item) => item.status === "已解决").length };
  $("#issueSummary").innerHTML = `<div><span>待处理</span><strong>${counts.open}</strong></div><div><span>沟通中</span><strong>${counts.talking}</strong></div><div><span>已解决</span><strong>${counts.solved}</strong></div>`;
  if (!sorted.length) {
    target.innerHTML = `<div class="empty-state module-empty"><i data-lucide="messages-square"></i><strong>目前没有问题记录</strong><span>有需要沟通的事情时，先把事实和期望写清楚。</span></div>`;
    return;
  }
  target.innerHTML = sorted.map((issue) => `<article class="issue-card ${issue.status === "已解决" ? "is-solved" : ""}"><div class="issue-card-head"><div><span>${formatDate(issue.date)}</span><h3>${escapeHtml(issue.title)}</h3></div><span class="status-label ${statusClass(issue.status)}">${escapeHtml(issue.status)}</span></div><div class="issue-block"><small>问题与感受</small><p>${escapeHtml(issue.description)}</p></div>${issue.proposal ? `<div class="issue-block proposal"><small>建议的下一步</small><p>${escapeHtml(issue.proposal)}</p></div>` : ""}<div class="issue-actions">${isReviewer() && issue.status === "待沟通" ? `<button class="button button-outline" data-action="update-issue" data-status="沟通中" data-id="${issue.id}"><i data-lucide="messages-square"></i>开始沟通</button>` : ""}${isReviewer() && issue.status !== "已解决" ? `<button class="button button-primary" data-action="update-issue" data-status="已解决" data-id="${issue.id}"><i data-lucide="badge-check"></i>确认解决</button>` : ""}${isRecorder() ? `<div class="row-actions"><button class="icon-button" data-action="edit-issue" data-id="${issue.id}" title="编辑问题"><i data-lucide="pencil"></i></button><button class="icon-button danger" data-action="delete-issue" data-id="${issue.id}" title="删除问题"><i data-lucide="trash-2"></i></button></div>` : ""}</div></article>`).join("");
}

function renderWishPreview() {
  const target = $("#wishPreview");
  target.innerHTML = data.wishes.slice(0, 4).map((wish) => {
    const count = data.redemptions.filter((item) => item.wishId === wish.id).length;
    return `<div class="wish-preview-item"><span class="wish-bullet"><i data-lucide="sparkles"></i></span><strong>${escapeHtml(wish.title)}</strong><small>${count ? `已兑换 ${count} 次` : "等待选择"}</small></div>`;
  }).join("");
}

function recordActions(record) {
  if (isRecorder()) return `<div class="row-actions"><button class="icon-button" data-action="edit-record" data-id="${record.id}" title="编辑行为日志"><i data-lucide="pencil"></i></button><button class="icon-button danger" data-action="delete-record" data-id="${record.id}" title="删除行为日志"><i data-lucide="trash-2"></i></button></div>`;
  if (isReviewer()) return `<div class="row-actions review-actions"><button class="icon-button" data-action="confirm-record" data-status="已确认" data-id="${record.id}" title="确认复核"><i data-lucide="badge-check"></i></button><button class="icon-button danger" data-action="confirm-record" data-status="需要再沟通" data-id="${record.id}" title="需要再沟通"><i data-lucide="message-circle-warning"></i></button></div>`;
  return `<span class="status-label">只读</span>`;
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
  const rows = filtered.map((record) => `<div class="record-row"><div class="record-cell record-date" data-label="日期">${formatDate(record.date)}</div><div class="record-cell situation" data-label="情境"><strong>${escapeHtml(record.situation)}</strong><small>${escapeHtml(record.notes || "")}</small></div><div class="record-cell" data-label="语气"><span class="status-label">${escapeHtml(record.tone)}</span></div><div class="record-cell repair" data-label="修复行动"><small>${escapeHtml(record.repair)}</small></div><div class="record-cell" data-label="确认"><span class="status-label ${statusClass(record.confirmation)}">${escapeHtml(record.confirmation)}</span></div><div class="record-cell action-cell" data-label="操作">${recordActions(record)}</div></div>`).join("");
  target.innerHTML = header + rows;
}

function renderWishes() {
  const target = $("#wishGrid");
  const m = metrics();
  target.innerHTML = data.wishes.map((wish, index) => {
    const related = data.redemptions.filter((item) => item.wishId === wish.id).sort((a, b) => b.redeemedAt.localeCompare(a.redeemedAt));
    const latest = related[0];
    return `<article class="wish-card ${latest?.status === "已完成" ? "is-done" : ""}"><div class="wish-card-top"><span class="wish-number">${String(index + 1).padStart(2, "0")}</span><span class="status-label ${latest ? statusClass(latest.status) : ""}">${related.length ? `兑换 ${related.length} 次` : "可选心愿"}</span></div><h3>${escapeHtml(wish.title)}</h3>${wish.description ? `<p class="wish-card-description">${escapeHtml(wish.description)}</p>` : ""}<div class="wish-card-meta">${latest ? `<span><i data-lucide="calendar-days"></i>最近兑换：${formatDate(latest.redeemedAt)}</span><span><i data-lucide="${latest.status === "已完成" ? "check" : "clock-3"}"></i>${escapeHtml(latest.status)}</span>` : `<span><i data-lucide="circle-dashed"></i>还没有兑换记录</span>`}</div><div class="wish-card-actions"><button class="button button-primary wish-redeem-button" data-action="redeem-wish" data-id="${wish.id}" type="button" ${isReviewer() && m.available < 1 ? "disabled" : ""}><i data-lucide="ticket-check"></i>${isReviewer() ? "兑换" : "路路登录兑换"}</button>${isReviewer() ? `<div class="row-actions"><button class="icon-button" data-action="edit-wish" data-id="${wish.id}" title="编辑心愿"><i data-lucide="pencil"></i></button><button class="icon-button danger" data-action="delete-wish" data-id="${wish.id}" title="删除心愿"><i data-lucide="trash-2"></i></button></div>` : ""}</div></article>`;
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
  target.innerHTML = sorted.map((item, index) => `<div class="redemption-row"><span class="redemption-index">${String(index + 1).padStart(2, "0")}</span><div class="redemption-main"><strong>${escapeHtml(item.wishTitle)}</strong><small>${item.completedAt ? `完成于 ${formatDate(item.completedAt)}` : "等待路路小皇帝确认"}</small></div><span class="redemption-date">兑换于 ${formatDate(item.redeemedAt)}</span><span class="status-label ${statusClass(item.status)}">${escapeHtml(item.status)}</span><div class="redemption-actions">${isReviewer() && item.status !== "已完成" ? `<button class="button button-outline" data-action="complete-redemption" data-id="${item.id}" type="button"><i data-lucide="check"></i>确认完成</button>` : ""}${isReviewer() ? `<button class="icon-button danger" data-action="delete-redemption" data-id="${item.id}" title="撤销这次兑换"><i data-lucide="undo-2"></i></button>` : ""}</div></div>`).join("");
}

function renderSettings() {
  $("#thresholdInput").value = data.settings.threshold;
  $("#periodStartInput").value = data.settings.periodStart;
  $("#agreementInput").value = data.settings.agreement;
  const roleName = isRecorder() ? "方方 · 记录者" : isReviewer() ? "路路小皇帝 · 复核者" : "访客模式";
  $("#adminStatus").textContent = isAdmin ? `${roleName} · 已解锁` : roleName;
  $("#adminStatus").classList.toggle("is-admin", isAdmin);
  const adminButton = $("#adminButton");
  adminButton.innerHTML = isAdmin
    ? `<i data-lucide="${isReviewer() ? "crown" : "pen-line"}" aria-hidden="true"></i><span>${roleName}</span>`
    : '<i data-lucide="lock-keyhole" aria-hidden="true"></i><span>身份登录</span>';
  adminButton.classList.toggle("is-admin", isAdmin);
  adminButton.setAttribute("aria-label", isAdmin ? `${roleName}已解锁，进入设置` : "选择身份登录");
  ["#thresholdInput", "#periodStartInput", "#agreementInput"].forEach((selector) => {
    $(selector).disabled = !isReviewer();
  });
  $$(".admin-only").forEach((element) => {
    if (element.matches("button")) element.disabled = false;
    element.classList.toggle("is-hidden-for-guest", !isAdmin);
  });
  $$(".recorder-action").forEach((element) => { if (element.matches("button")) element.disabled = false; });
  $$(".reviewer-action").forEach((element) => { element.disabled = element.closest("#settingsForm") ? !isReviewer() : false; });
  $("#taskTitleInput").disabled = !isRecorder();
  $("#privacyText").textContent = isAdmin ? `${roleName} · 退出即锁定` : "本地私密模式";
}

function renderView() {
  const validViews = ["overview", "daily", "records", "issues", "wishes", "settings"];
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
  renderMoments();
  renderTasks();
  renderIssues();
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
  toast(action ? `请先选择身份登录后再${action}` : "请先选择身份登录");
  return false;
}

function selectLoginRole(role) {
  $("#loginRole").value = role;
  $$("[data-login-role]").forEach((button) => button.classList.toggle("is-selected", button.dataset.loginRole === role));
  $("#authError").hidden = true;
}

function requireRole(role, action) {
  if (currentRole === role) return true;
  selectLoginRole(role);
  openModal("authModal");
  toast(`需要${role === "recorder" ? "方方记录者" : "路路小皇帝复核者"}身份才能${action}`);
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

function currentPasswordHash(role) {
  const defaults = DEFAULT_PASSWORD_HASHES[role] || DEFAULT_PASSWORD_HASHES.recorder;
  return localStorage.getItem(PASSWORD_HASH_KEYS[role]) || `sha256:${defaults.sha256}|fallback:${defaults.fallback}`;
}

async function passwordMatches(value, stored) {
  const fallback = `fallback:${fallbackHash(value)}`;
  if (stored === fallback || stored.split("|").includes(fallback)) return true;
  if (!globalThis.crypto?.subtle) return false;
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const sha256 = [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return stored === sha256 || stored === `sha256:${sha256}` || stored.split("|").includes(`sha256:${sha256}`);
}

function unlock(role) {
  currentRole = role;
  isAdmin = true;
  touchAdminSession();
  closeModal("authModal");
  $("#passwordInput").value = "";
  $("#authError").hidden = true;
  render();
  setView(role === "recorder" ? "daily" : "overview");
  toast(role === "recorder" ? "方方记录身份已解锁" : "路路小皇帝复核身份已解锁");
}

function resetLocalPassword() {
  const role = $("#loginRole").value || currentRole || "recorder";
  localStorage.removeItem(PASSWORD_HASH_KEYS[role]);
  isAdmin = false;
  currentRole = null;
  lastAdminActivity = 0;
  $("#passwordInput").value = "";
  $("#authError").hidden = true;
  render();
  toast(`${role === "recorder" ? "方方" : "路路小皇帝"}的本机密码已重置`);
  setTimeout(() => $("#passwordInput").focus(), 30);
}

function logout() {
  isAdmin = false;
  currentRole = null;
  lastAdminActivity = 0;
  render();
  toast("已退出并重新锁定");
}

function checkAdminSession() {
  if (!isAdmin) return;
  if (!lastAdminActivity || Date.now() - lastAdminActivity > SESSION_TIMEOUT_MS) {
    isAdmin = false;
    currentRole = null;
    lastAdminActivity = 0;
    render();
    toast("身份会话已自动锁定");
  }
}

function openRecordEditor(id = "") {
  if (!requireRole("recorder", "编辑行为日志")) return;
  const record = data.records.find((item) => item.id === id);
  $("#recordModalTitle").textContent = record ? "编辑复盘记录" : "新增复盘记录";
  $("#recordId").value = record?.id || "";
  $("#recordDate").value = record?.date || today();
  $("#recordTone").value = record?.tone || "提高音量";
  $("#recordSituation").value = record?.situation || "";
  $("#recordRepair").value = record?.repair || "";
  $("#recordConfirmation").value = record?.confirmation || "待确认";
  $("#recordConfirmation").disabled = true;
  $("#recordNotes").value = record?.notes || "";
  openModal("recordModal");
}

function openWishEditor(id = "") {
  if (!requireRole("reviewer", "编辑心愿")) return;
  const wish = data.wishes.find((item) => item.id === id);
  $("#wishModalTitle").textContent = wish ? "编辑心愿" : "新增心愿";
  $("#wishId").value = wish?.id || "";
  $("#wishTitle").value = wish?.title || "";
  $("#wishDescription").value = wish?.description || "";
  openModal("wishModal");
}

function renderMomentImagePreview() {
  const existing = editingMomentImageIds.map((id) => ({ id, dataUrl: imageCache.get(id)?.dataUrl, kind: "existing" })).filter((item) => item.dataUrl);
  const pending = pendingMomentImages.map((item, index) => ({ id: String(index), dataUrl: item.dataUrl, kind: "pending" }));
  const items = [...existing, ...pending];
  $("#momentImagePreview").innerHTML = items.map((item) => `<div class="image-preview-item"><img src="${item.dataUrl}" alt="待上传照片预览" /><button type="button" data-action="remove-moment-image" data-kind="${item.kind}" data-id="${item.id}" aria-label="移除照片"><i data-lucide="x"></i></button></div>`).join("");
  refreshIcons();
}

function openMomentEditor(id = "") {
  if (!requireRole("recorder", "记录美好生活")) return;
  const moment = data.moments.find((item) => item.id === id);
  $("#momentModalTitle").textContent = moment ? "编辑美好记录" : "记录一件美好小事";
  $("#momentId").value = moment?.id || "";
  $("#momentDate").value = moment?.date || today();
  $("#momentTitle").value = moment?.title || "";
  $("#momentNote").value = moment?.note || "";
  $("#momentImages").value = "";
  pendingMomentImages = [];
  editingMomentImageIds = [...(moment?.imageIds || [])];
  originalMomentImageIds = [...editingMomentImageIds];
  renderMomentImagePreview();
  openModal("momentModal");
}

function openIssueEditor(id = "") {
  if (!requireRole("recorder", "记录当前问题")) return;
  const issue = data.issues.find((item) => item.id === id);
  $("#issueModalTitle").textContent = issue ? "编辑问题记录" : "记录当前问题";
  $("#issueId").value = issue?.id || "";
  $("#issueDate").value = issue?.date || today();
  $("#issueTitle").value = issue?.title || "";
  $("#issueDescription").value = issue?.description || "";
  $("#issueProposal").value = issue?.proposal || "";
  openModal("issueModal");
}

function updateIssue(id, status) {
  if (!requireRole("reviewer", "复核问题状态")) return;
  const issue = data.issues.find((item) => item.id === id);
  if (!issue) return;
  issue.status = status;
  issue.reviewedAt = today();
  saveData();
  render();
  toast(status === "已解决" ? "问题已确认解决" : "问题已进入沟通中");
}

function toggleTask(id) {
  if (!requireRole("recorder", "更新手账任务")) return;
  const task = data.tasks.find((item) => item.id === id);
  if (!task) return;
  task.done = !task.done;
  if (!task.done) {
    task.reviewed = false;
    task.reviewedAt = "";
  }
  saveData();
  render();
  toast(task.done ? "任务已完成，等待路路复核" : "任务已恢复为待完成");
}

function reviewTask(id) {
  if (!requireRole("reviewer", "复核手账任务")) return;
  const task = data.tasks.find((item) => item.id === id);
  if (!task || !task.done) return;
  task.reviewed = true;
  task.reviewedAt = today();
  saveData();
  render();
  toast("手账任务已复核");
}

function reviewMoment(id) {
  if (!requireRole("reviewer", "复核美好记录")) return;
  const moment = data.moments.find((item) => item.id === id);
  if (!moment) return;
  moment.reviewStatus = "已复核";
  moment.reviewedAt = today();
  saveData();
  render();
  toast("美好记录已复核");
}

function redeemWish(id) {
  if (!requireRole("reviewer", "兑换心愿")) return;
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
  if (!requireRole("reviewer", "确认兑换完成")) return;
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

async function exportBackup() {
  if (!requireAdmin("导出备份")) return;
  try {
    const media = await getAllMedia();
    const payload = { version: DATA_VERSION, exportedAt: new Date().toISOString(), app: "lulu-fangfang-house", data, media };
    downloadText(`lulu-fangfang-backup-${today()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    toast(`完整备份已下载，包含 ${media.length} 张图片`);
  } catch {
    toast("备份失败：无法读取当前浏览器的图片库");
  }
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
  if (!confirm("导入会覆盖当前记录；完整备份中的图片也会替换本地图片库。确定继续吗？")) return;
  $("#importFile").click();
}

function handleImport(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incoming = parsed.data || parsed;
      if (!incoming || !Array.isArray(incoming.records) || !Array.isArray(incoming.wishes) || !incoming.settings) throw new Error("invalid");
      data = normalizeData(incoming);
      if (Array.isArray(parsed.media)) {
        await clearAllMedia();
        for (const item of parsed.media) {
          if (item && typeof item.id === "string" && typeof item.dataUrl === "string" && item.dataUrl.startsWith("data:image/")) await putMedia(item);
        }
      }
      saveData();
      await hydrateMediaCache();
      render();
      toast("备份已导入");
    } catch {
      toast("导入失败：文件格式不正确");
    }
  };
  reader.readAsText(file);
}

document.addEventListener("click", async (event) => {
  const roleOption = event.target.closest("[data-login-role]");
  if (roleOption) selectLoginRole(roleOption.dataset.loginRole);
  const tab = event.target.closest("[data-view]");
  if (tab) setView(tab.dataset.view);
  const target = event.target.closest("[data-view-target]");
  if (target) setView(target.dataset.viewTarget);
  const close = event.target.closest("[data-close-modal]");
  if (close) closeModal(close.dataset.closeModal);
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  const action = actionElement.dataset.action;
  if (action === "new-moment") openMomentEditor();
  if (action === "edit-moment") openMomentEditor(actionElement.dataset.id);
  if (action === "review-moment") reviewMoment(actionElement.dataset.id);
  if (action === "remove-moment-image") {
    if (actionElement.dataset.kind === "existing") editingMomentImageIds = editingMomentImageIds.filter((id) => id !== actionElement.dataset.id);
    else pendingMomentImages.splice(Number(actionElement.dataset.id), 1);
    renderMomentImagePreview();
  }
  if (action === "delete-moment" && requireRole("recorder", "删除美好记录") && confirm("确定删除这条美好记录和其中的本地照片吗？")) {
    const moment = data.moments.find((item) => item.id === actionElement.dataset.id);
    for (const id of moment?.imageIds || []) await deleteMedia(id).catch(() => {});
    data.moments = data.moments.filter((item) => item.id !== actionElement.dataset.id);
    saveData(); render(); toast("美好记录已删除");
  }
  if (action === "toggle-task") toggleTask(actionElement.dataset.id);
  if (action === "review-task") reviewTask(actionElement.dataset.id);
  if (action === "delete-task" && requireRole("recorder", "删除手账任务") && confirm("确定删除这项任务吗？")) {
    data.tasks = data.tasks.filter((item) => item.id !== actionElement.dataset.id);
    saveData(); render(); toast("任务已删除");
  }
  if (action === "new-record") openRecordEditor();
  if (action === "edit-record") openRecordEditor(actionElement.dataset.id);
  if (action === "confirm-record" && requireRole("reviewer", "复核行为日志")) {
    const record = data.records.find((item) => item.id === actionElement.dataset.id);
    if (record) { record.confirmation = actionElement.dataset.status; saveData(); render(); toast("行为日志复核状态已更新"); }
  }
  if (action === "delete-record" && requireRole("recorder", "删除行为日志") && confirm("确定删除这条行为日志吗？")) {
    data.records = data.records.filter((record) => record.id !== actionElement.dataset.id);
    saveData(); render(); toast("记录已删除");
  }
  if (action === "new-issue") openIssueEditor();
  if (action === "edit-issue") openIssueEditor(actionElement.dataset.id);
  if (action === "update-issue") updateIssue(actionElement.dataset.id, actionElement.dataset.status);
  if (action === "delete-issue" && requireRole("recorder", "删除问题记录") && confirm("确定删除这条问题沟通记录吗？")) {
    data.issues = data.issues.filter((item) => item.id !== actionElement.dataset.id);
    saveData(); render(); toast("问题记录已删除");
  }
  if (action === "new-wish") openWishEditor();
  if (action === "edit-wish") openWishEditor(actionElement.dataset.id);
  if (action === "redeem-wish") redeemWish(actionElement.dataset.id);
  if (action === "delete-wish" && requireRole("reviewer", "删除心愿") && confirm("确定删除这份心愿吗？已有兑换流水会继续保留。")) {
    data.wishes = data.wishes.filter((wish) => wish.id !== actionElement.dataset.id);
    saveData(); render(); toast("心愿已删除");
  }
  if (action === "complete-redemption") completeRedemption(actionElement.dataset.id);
  if (action === "delete-redemption" && requireRole("reviewer", "撤销兑换") && confirm("确定撤销这次兑换吗？对应的 1 份心愿余额会恢复。")) {
    data.redemptions = data.redemptions.filter((item) => item.id !== actionElement.dataset.id);
    saveData(); render(); toast("兑换已撤销，余额已恢复");
  }
  if (action === "export") exportBackup();
  if (action === "export-csv") exportRecordsCsv();
  if (action === "import") importBackup();
  if (action === "logout") logout();
  if (action === "reset-password" && confirm("只重置当前所选身份在这个浏览器中的密码，不会删除数据。确定继续吗？")) resetLocalPassword();
  if (action === "change-password" && requireAdmin("修改密码")) {
    $("#passwordModalTitle").textContent = `修改${isRecorder() ? "方方" : "路路小皇帝"}的密码`;
    openModal("passwordModal");
  }
});

$("#adminButton").addEventListener("click", () => isAdmin ? setView("settings") : openModal("authModal"));

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const role = $("#loginRole").value || "recorder";
  try {
    const matches = await passwordMatches($("#passwordInput").value, currentPasswordHash(role));
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
  unlock(role);
});

$("#recordForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireRole("recorder", "保存行为日志")) return;
  const id = $("#recordId").value || `record-${Date.now()}`;
  const record = { id, date: $("#recordDate").value, tone: $("#recordTone").value, situation: $("#recordSituation").value.trim(), repair: $("#recordRepair").value.trim(), confirmation: "待确认", notes: $("#recordNotes").value.trim() };
  const existingIndex = data.records.findIndex((item) => item.id === id);
  if (existingIndex >= 0) data.records[existingIndex] = record;
  else data.records.push(record);
  saveData(); closeModal("recordModal"); render(); toast(existingIndex >= 0 ? "记录已更新" : "记录已保存");
});

$("#momentImages").addEventListener("change", async (event) => {
  const remaining = 4 - editingMomentImageIds.length - pendingMomentImages.length;
  const selectedFiles = [...event.target.files];
  const files = selectedFiles.slice(0, Math.max(0, remaining));
  event.target.value = "";
  if (!files.length) { toast("每条美好记录最多保存 4 张照片"); return; }
  if (selectedFiles.length > files.length) toast(`本次只添加前 ${files.length} 张，单条记录最多 4 张`);
  else toast("正在压缩照片，请稍候");
  for (const file of files) {
    try {
      pendingMomentImages.push({ id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, dataUrl: await compressImage(file), createdAt: new Date().toISOString() });
    } catch {
      toast(`照片 ${file.name} 处理失败`);
    }
  }
  renderMomentImagePreview();
});

$("#momentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireRole("recorder", "保存美好记录")) return;
  const id = $("#momentId").value || `moment-${Date.now()}`;
  for (const image of pendingMomentImages) await putMedia(image);
  for (const removedId of originalMomentImageIds.filter((imageId) => !editingMomentImageIds.includes(imageId))) await deleteMedia(removedId).catch(() => {});
  const existingIndex = data.moments.findIndex((item) => item.id === id);
  const moment = { id, date: $("#momentDate").value, title: $("#momentTitle").value.trim(), note: $("#momentNote").value.trim(), imageIds: [...editingMomentImageIds, ...pendingMomentImages.map((image) => image.id)], reviewStatus: "待复核", reviewedAt: "", createdBy: "recorder" };
  if (existingIndex >= 0) data.moments[existingIndex] = moment;
  else data.moments.push(moment);
  pendingMomentImages = [];
  editingMomentImageIds = [];
  originalMomentImageIds = [];
  saveData(); closeModal("momentModal"); render(); toast(existingIndex >= 0 ? "美好记录已更新，等待重新复核" : "美好记录已保存");
});

$("#taskQuickForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireRole("recorder", "添加手账任务")) return;
  const title = $("#taskTitleInput").value.trim();
  if (!title) { toast("请先写下要做的事情"); return; }
  const date = $("#taskDateFilter").value || today();
  data.tasks.push({ id: `task-${Date.now()}`, date, title, done: false, reviewed: false, reviewedAt: "", createdAt: new Date().toISOString(), createdBy: "recorder" });
  $("#taskTitleInput").value = "";
  saveData(); render(); toast("任务已加入手账");
});

$("#taskDateFilter").addEventListener("change", () => {
  renderTasks();
  refreshIcons();
});

$("#issueForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireRole("recorder", "保存问题记录")) return;
  const id = $("#issueId").value || `issue-${Date.now()}`;
  const existingIndex = data.issues.findIndex((item) => item.id === id);
  const issue = { id, date: $("#issueDate").value, title: $("#issueTitle").value.trim(), description: $("#issueDescription").value.trim(), proposal: $("#issueProposal").value.trim(), status: "待沟通", reviewedAt: "", createdBy: "recorder" };
  if (existingIndex >= 0) data.issues[existingIndex] = issue;
  else data.issues.push(issue);
  saveData(); closeModal("issueModal"); render(); toast(existingIndex >= 0 ? "问题记录已更新" : "问题已记录，等待沟通");
});

$("#wishForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireRole("reviewer", "保存心愿")) return;
  const id = $("#wishId").value || `wish-${Date.now()}`;
  const wish = { id, title: $("#wishTitle").value.trim(), description: $("#wishDescription").value.trim() };
  const existingIndex = data.wishes.findIndex((item) => item.id === id);
  if (existingIndex >= 0) data.wishes[existingIndex] = wish;
  else data.wishes.push(wish);
  saveData(); closeModal("wishModal"); render(); toast(existingIndex >= 0 ? "心愿已更新" : "心愿已保存");
});

$("#settingsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!requireRole("reviewer", "保存规则")) return;
  data.settings.threshold = Math.max(1, Number($("#thresholdInput").value) || 1);
  data.settings.periodStart = $("#periodStartInput").value || today();
  data.settings.agreement = $("#agreementInput").value.trim() || defaultData.settings.agreement;
  saveData(); render(); toast("规则已保存");
});

$("#passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("#passwordError");
  if (!currentRole || !(await passwordMatches($("#currentPassword").value, currentPasswordHash(currentRole)))) { error.textContent = "当前密码不正确。"; error.hidden = false; return; }
  if ($("#newPassword").value.length < 8) { error.textContent = "新密码至少需要 8 位。"; error.hidden = false; return; }
  if ($("#newPassword").value !== $("#confirmPassword").value) { error.textContent = "两次输入的新密码不一致。"; error.hidden = false; return; }
  localStorage.setItem(PASSWORD_HASH_KEYS[currentRole], await passwordRecord($("#newPassword").value));
  $("#passwordForm").reset(); error.hidden = true; closeModal("passwordModal"); toast("当前身份密码已更新");
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
window.addEventListener("pagehide", () => {
  isAdmin = false;
  currentRole = null;
  lastAdminActivity = 0;
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  isAdmin = false;
  currentRole = null;
  lastAdminActivity = 0;
  render();
});
document.addEventListener("pointerdown", touchAdminSession, { passive: true });
document.addEventListener("keydown", (event) => {
  touchAdminSession();
  if (event.key === "Escape") $$(".modal-backdrop:not([hidden])").forEach((modal) => { modal.hidden = true; });
});
setInterval(checkAdminSession, 60 * 1000);

async function initialize() {
  $("#todayLabel").textContent = formatDate(today());
  $("#taskDateFilter").value = today();
  await hydrateMediaCache();
  render();
}

initialize();
