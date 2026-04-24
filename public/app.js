const appState = {
  files: [],
  filteredFiles: [],
  stats: {
    total: 0,
    size: 0,
    favorites: 0,
    trash: 0,
    counts: {},
  },
  health: {
    ok: false,
    storage: "local",
  },
  activeType: "all",
  query: "",
  sort: "uploadedAt",
  order: "desc",
  selectedIds: new Set(),
  activeFileId: null,
  deviceName: localStorage.getItem("vaultDeviceName") || "",
  uploadQueue: [],
  uploading: false,
  layoutEditing: false,
};

const elements = {
  statTotal: document.getElementById("statTotal"),
  statSize: document.getElementById("statSize"),
  statFav: document.getElementById("statFav"),
  resultHint: document.getElementById("resultHint"),
  queueHint: document.getElementById("queueHint"),
  selectionCount: document.getElementById("selectionCount"),
  selectionCountMirror: document.getElementById("selectionCountMirror"),
  healthBadge: document.getElementById("healthBadge"),
  clockValue: document.getElementById("clockValue"),
  filterValue: document.getElementById("filterValue"),
  fileList: document.getElementById("fileList"),
  queueList: document.getElementById("queueList"),
  typeTabs: document.getElementById("typeTabs"),
  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),
  orderBtn: document.getElementById("orderBtn"),
  uploadBtn: document.getElementById("uploadBtn"),
  uploadBtnMirror: document.getElementById("uploadBtnMirror"),
  fileInput: document.getElementById("fileInput"),
  batchDownloadBtn: document.getElementById("batchDownloadBtn"),
  batchDownloadBtnMirror: document.getElementById("batchDownloadBtnMirror"),
  batchDeleteBtn: document.getElementById("batchDeleteBtn"),
  batchDeleteBtnMirror: document.getElementById("batchDeleteBtnMirror"),
  dropZone: document.getElementById("dropZone"),
  deviceName: document.getElementById("deviceName"),
  previewPanel: document.getElementById("previewPanel"),
  closePreviewBtn: document.getElementById("closePreviewBtn"),
  previewEmpty: document.getElementById("previewEmpty"),
  previewContent: document.getElementById("previewContent"),
  previewMedia: document.getElementById("previewMedia"),
  metaName: document.getElementById("metaName"),
  metaTime: document.getElementById("metaTime"),
  metaSize: document.getElementById("metaSize"),
  metaType: document.getElementById("metaType"),
  metaDevice: document.getElementById("metaDevice"),
  noteInput: document.getElementById("noteInput"),
  tagsInput: document.getElementById("tagsInput"),
  saveMetaBtn: document.getElementById("saveMetaBtn"),
  favoriteBtn: document.getElementById("favoriteBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  restoreBtn: document.getElementById("restoreBtn"),
  purgeBtn: document.getElementById("purgeBtn"),
  toast: document.getElementById("toast"),
  pointerGlow: document.getElementById("pointerGlow"),
  layoutModeBtn: document.getElementById("layoutModeBtn"),
  layoutModeText: document.getElementById("layoutModeText"),
};

const fileCardTemplate = document.getElementById("fileCardTemplate");
const queueItemTemplate = document.getElementById("queueItemTemplate");

const typeTabs = [
  { key: "all", label: "全部文件" },
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
  { key: "document", label: "文档" },
  { key: "text", label: "文本" },
  { key: "other", label: "其他" },
  { key: "favorite", label: "收藏" },
  { key: "trash", label: "回收站" },
];

const groupIcons = {
  image: "IMG",
  video: "VID",
  document: "DOC",
  text: "TXT",
  other: "ZIP",
};

const groupAccents = {
  image: "#f4c274",
  video: "#78f0ff",
  document: "#8ff1b5",
  text: "#ff8e89",
  other: "#9a82ff",
};

const panelOffsetStorageKey = "vaultPanelOffsets";

boot();

async function boot() {
  elements.deviceName.value = appState.deviceName;
  elements.orderBtn.textContent = "倒序";
  bindEvents();
  startClock();
  startPointerEffects();
  startRevealObserver();
  setupLayoutEditing();
  renderTabs();
  renderQueue();
  await loadHealth();
  await refreshFiles();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", async (event) => {
    appState.query = event.target.value.trim();
    await refreshFiles();
  });

  elements.sortSelect.addEventListener("change", async (event) => {
    appState.sort = event.target.value;
    await refreshFiles();
  });

  elements.orderBtn.addEventListener("click", async () => {
    appState.order = appState.order === "desc" ? "asc" : "desc";
    elements.orderBtn.textContent = appState.order === "desc" ? "倒序" : "正序";
    await refreshFiles();
  });

  elements.deviceName.addEventListener("change", () => {
    appState.deviceName = elements.deviceName.value.trim();
    localStorage.setItem("vaultDeviceName", appState.deviceName);
  });

  elements.uploadBtn.addEventListener("click", () => elements.fileInput.click());
  elements.uploadBtnMirror.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    await queueFiles(files);
    event.target.value = "";
  });

  elements.batchDownloadBtn.addEventListener("click", downloadSelectedFiles);
  elements.batchDownloadBtnMirror.addEventListener("click", downloadSelectedFiles);
  elements.batchDeleteBtn.addEventListener("click", deleteSelectedFiles);
  elements.batchDeleteBtnMirror.addEventListener("click", deleteSelectedFiles);
  elements.closePreviewBtn.addEventListener("click", closePreview);
  elements.saveMetaBtn.addEventListener("click", saveActiveMetadata);
  elements.favoriteBtn.addEventListener("click", toggleActiveFavorite);
  elements.downloadBtn.addEventListener("click", downloadActiveFile);
  elements.deleteBtn.addEventListener("click", deleteActiveFile);
  elements.restoreBtn.addEventListener("click", restoreActiveFile);
  elements.purgeBtn.addEventListener("click", purgeActiveFile);
  elements.layoutModeBtn.addEventListener("click", toggleLayoutEditing);

  for (const eventName of ["dragenter", "dragover"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      elements.dropZone.classList.add("is-dragover");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      elements.dropZone.classList.remove("is-dragover");
    });
  }

  elements.dropZone.addEventListener("drop", async (event) => {
    const files = Array.from(event.dataTransfer.files || []);
    await queueFiles(files);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePreview();
  });
}

function startPointerEffects() {
  const root = document.documentElement;

  const updatePointer = (clientX, clientY) => {
    const xPercent = (clientX / window.innerWidth) * 100;
    const yPercent = (clientY / window.innerHeight) * 100;
    root.style.setProperty("--pointer-x", `${xPercent}%`);
    root.style.setProperty("--pointer-y", `${yPercent}%`);
    root.style.setProperty("--motion-x", `${(xPercent - 50) * 0.18}px`);
    root.style.setProperty("--motion-y", `${(yPercent - 50) * 0.12}px`);
  };

  window.addEventListener("mousemove", (event) => {
    updatePointer(event.clientX, event.clientY);
    applyTilt(event);
  });

  window.addEventListener(
    "touchmove",
    (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      updatePointer(touch.clientX, touch.clientY);
    },
    { passive: true }
  );

  document.addEventListener("mouseleave", resetTilt);
}

function applyTilt(event) {
  document.querySelectorAll(".motionCard").forEach((card) => {
    const rect = card.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      return;
    }

    const rotateY = ((event.clientX - rect.left) / rect.width - 0.5) * 6;
    const rotateX = ((event.clientY - rect.top) / rect.height - 0.5) * -6;
    card.style.transform = `translateY(-2px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`;
  });
}

function resetTilt() {
  document.querySelectorAll(".motionCard").forEach((card) => {
    card.style.transform = "";
  });
}

function startRevealObserver() {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    {
      threshold: 0.16,
    }
  );

  document.querySelectorAll(".reveal").forEach((node) => observer.observe(node));
}

function setupLayoutEditing() {
  const savedOffsets = loadPanelOffsets();
  const panels = [...document.querySelectorAll(".panelDrift[data-panel-id]")];

  for (const panel of panels) {
    const panelId = panel.dataset.panelId;
    const saved = savedOffsets[panelId] || { x: 0, y: 0 };
    applyPanelOffset(panel, saved.x, saved.y);

    const beginDrag = (startX, startY) => {
      if (!appState.layoutEditing) return;

      const initialX = Number(panel.dataset.dragX || 0);
      const initialY = Number(panel.dataset.dragY || 0);
      panel.classList.add("is-dragging");

      const moveTo = (clientX, clientY) => {
        const nextX = initialX + clientX - startX;
        const nextY = initialY + clientY - startY;
        applyPanelOffset(panel, nextX, nextY);
      };

      const handleMouseMove = (moveEvent) => moveTo(moveEvent.clientX, moveEvent.clientY);
      const handleTouchMove = (moveEvent) => {
        const touch = moveEvent.touches[0];
        if (!touch) return;
        moveTo(touch.clientX, touch.clientY);
      };

      const handleEnd = () => {
        panel.classList.remove("is-dragging");
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleEnd);
        window.removeEventListener("touchmove", handleTouchMove);
        window.removeEventListener("touchend", handleEnd);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleEnd, { once: true });
      window.addEventListener("touchmove", handleTouchMove, { passive: true });
      window.addEventListener("touchend", handleEnd, { once: true });
    };

    panel.addEventListener("mousedown", (event) => {
      if (!appState.layoutEditing) return;
      if (event.button !== 0) return;
      event.preventDefault();
      beginDrag(event.clientX, event.clientY);
    });

    panel.addEventListener(
      "touchstart",
      (event) => {
        if (!appState.layoutEditing) return;
        const touch = event.touches[0];
        if (!touch) return;
        beginDrag(touch.clientX, touch.clientY);
      },
      { passive: true }
    );
  }

  window.addEventListener("resize", () => {
    if (appState.layoutEditing) return;
    syncLayoutModeButton();
  });

  syncLayoutModeButton();
}

function applyPanelOffset(panel, x, y, syncDataset = true) {
  panel.style.setProperty("--drag-x", `${x}px`);
  panel.style.setProperty("--drag-y", `${y}px`);
  if (!syncDataset) return;
  panel.dataset.dragX = String(x);
  panel.dataset.dragY = String(y);
}

function loadPanelOffsets() {
  try {
    return JSON.parse(localStorage.getItem(panelOffsetStorageKey) || "{}");
  } catch (error) {
    return {};
  }
}

function persistPanelOffset(panelId, x, y) {
  const offsets = loadPanelOffsets();
  offsets[panelId] = { x, y };
  localStorage.setItem(panelOffsetStorageKey, JSON.stringify(offsets));
}

function persistAllPanelOffsets() {
  const offsets = {};
  for (const panel of document.querySelectorAll(".panelDrift[data-panel-id]")) {
    offsets[panel.dataset.panelId] = {
      x: Number(panel.dataset.dragX || 0),
      y: Number(panel.dataset.dragY || 0),
    };
  }
  localStorage.setItem(panelOffsetStorageKey, JSON.stringify(offsets));
}

function toggleLayoutEditing() {
  appState.layoutEditing = !appState.layoutEditing;
  document.body.classList.toggle("is-layout-editing", appState.layoutEditing);

  if (!appState.layoutEditing) {
    persistAllPanelOffsets();
    toast("布局已保存");
  } else {
    toast("已进入布局模式，可拖动任意模块");
  }

  syncLayoutModeButton();
}

function syncLayoutModeButton() {
  elements.layoutModeBtn.classList.toggle("is-active", appState.layoutEditing);
  elements.layoutModeBtn.setAttribute("aria-pressed", String(appState.layoutEditing));
  elements.layoutModeText.textContent = appState.layoutEditing ? "保存布局" : "布局模式";
}

async function loadHealth() {
  try {
    const health = await apiJson("/api/health");
    appState.health.ok = Boolean(health.ok);
    appState.health.storage = health.storage || "local";
  } catch (error) {
    appState.health.ok = false;
    appState.health.storage = "unreachable";
  }

  renderHealth();
}

function renderHealth() {
  let label = "连接异常";

  if (appState.health.ok) {
    if (appState.health.storage === "s3") label = "对象存储在线";
    else if (appState.health.storage === "local") label = "本地存储在线";
    else label = "服务在线";
  }

  elements.healthBadge.textContent = label;
  document.body.dataset.storage = appState.health.storage;
}

function startClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

function updateClock() {
  elements.clockValue.textContent = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function renderTabs() {
  elements.typeTabs.innerHTML = "";

  for (const tab of typeTabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab ${tab.key === appState.activeType ? "is-active" : ""}`;

    const label = document.createElement("span");
    label.textContent = tab.label;
    button.appendChild(label);

    const count = document.createElement("span");
    count.className = "tab__count";
    count.textContent = String(getTabCount(tab.key));
    button.appendChild(count);

    button.addEventListener("click", async () => {
      appState.activeType = tab.key;
      renderTabs();
      await refreshFiles();
    });

    elements.typeTabs.appendChild(button);
  }
}

function getTabCount(key) {
  if (key === "all") return appState.stats.total || 0;
  if (key === "favorite") return appState.stats.favorites || 0;
  if (key === "trash") return appState.stats.trash || 0;
  return (appState.stats.counts && appState.stats.counts[key]) || 0;
}

async function refreshFiles() {
  const params = new URLSearchParams({
    q: appState.query,
    type: appState.activeType,
    sort: appState.sort,
    order: appState.order,
    includeDeleted: "true",
  });

  const data = await apiJson(`/api/files?${params.toString()}`);
  appState.files = data.files || [];
  appState.stats = {
    total: 0,
    size: 0,
    favorites: 0,
    trash: 0,
    counts: {},
    ...(data.stats || {}),
  };
  appState.filteredFiles = filterFilesForView();
  cleanupSelection();

  renderTabs();
  renderStats();
  renderFileList();
  updatePreview();
}

function filterFilesForView() {
  return appState.files.filter((file) => {
    if (appState.activeType === "favorite") return file.favorite && !file.deletedAt;
    if (appState.activeType === "trash") return Boolean(file.deletedAt);
    if (file.deletedAt) return false;
    if (appState.activeType !== "all" && file.group !== appState.activeType) return false;

    if (!appState.query) return true;

    const haystack = [
      file.originalName,
      file.note,
      ...(file.tags || []),
      file.deviceName,
      file.groupLabel,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(appState.query.toLowerCase());
  });
}

function cleanupSelection() {
  const ids = new Set(appState.files.map((file) => file.id));
  for (const id of appState.selectedIds) {
    if (!ids.has(id)) appState.selectedIds.delete(id);
  }
}

function renderStats() {
  elements.statTotal.textContent = String(appState.stats.total || 0);
  elements.statSize.textContent = formatBytes(appState.stats.size || 0);
  elements.statFav.textContent = String(appState.stats.favorites || 0);
  elements.resultHint.textContent = `${appState.filteredFiles.length} 个文件`;
  elements.selectionCount.textContent = `${appState.selectedIds.size} 个已选`;
  elements.selectionCountMirror.textContent = `${appState.selectedIds.size} 个已选`;
  elements.queueHint.textContent = appState.uploadQueue.length
    ? `${appState.uploadQueue.length} 个文件等待处理`
    : "拖拽文件到下方上传区";
  elements.filterValue.textContent = getFilterLabel();
}

function getFilterLabel() {
  const active = typeTabs.find((tab) => tab.key === appState.activeType);
  return active ? active.label : "全部文件";
}

function renderFileList() {
  elements.fileList.innerHTML = "";

  if (!appState.filteredFiles.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = "当前筛选条件下还没有文件。你可以先上传图片、视频、PPT、PDF 或任意文件来建立你的第一批资料。";
    elements.fileList.appendChild(empty);
    return;
  }

  for (const file of appState.filteredFiles) {
    const fragment = fileCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".fileCard");
    const mainButton = fragment.querySelector(".fileCard__main");
    const icon = fragment.querySelector(".fileCard__icon");
    const title = fragment.querySelector(".fileCard__title");
    const meta = fragment.querySelector(".fileCard__meta");
    const tags = fragment.querySelector(".fileCard__tags");
    const favorite = fragment.querySelector(".fileCard__fav");
    const checkbox = fragment.querySelector(".selectFile");

    const accent = groupAccents[file.group] || groupAccents.other;
    card.style.setProperty("--accent", accent);

    icon.textContent = groupIcons[file.group] || groupIcons.other;
    title.textContent = file.originalName;
    meta.textContent = [
      formatDate(file.uploadedAt),
      formatBytes(file.size),
      file.groupLabel,
      file.deviceName || "未知设备",
    ].join(" · ");
    favorite.textContent = file.favorite ? "★" : "☆";
    checkbox.checked = appState.selectedIds.has(file.id);
    card.classList.toggle("is-selected", checkbox.checked);
    card.classList.toggle("is-deleted", Boolean(file.deletedAt));

    const labels = [];
    if (file.favorite) labels.push("收藏");
    if (file.deletedAt) labels.push("已删除");
    for (const tag of (file.tags || []).slice(0, 4)) labels.push(tag);

    tags.innerHTML = "";
    for (const label of labels) {
      const node = document.createElement("span");
      node.className = "tag";
      node.textContent = label;
      tags.appendChild(node);
    }

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) appState.selectedIds.add(file.id);
      else appState.selectedIds.delete(file.id);
      card.classList.toggle("is-selected", checkbox.checked);
      renderStats();
    });

    mainButton.addEventListener("click", () => openPreview(file.id));
    elements.fileList.appendChild(fragment);
  }
}

function openPreview(fileId) {
  const file = getActiveFile(fileId);
  if (!file) return;

  appState.activeFileId = file.id;
  elements.previewPanel.classList.add("is-open");
  elements.previewEmpty.classList.add("hidden");
  elements.previewContent.classList.remove("hidden");

  elements.metaName.textContent = file.originalName;
  elements.metaTime.textContent = formatDate(file.uploadedAt);
  elements.metaSize.textContent = formatBytes(file.size);
  elements.metaType.textContent = `${file.groupLabel} / ${file.mimeType || "unknown"}`;
  elements.metaDevice.textContent = file.deviceName || "未知设备";
  elements.noteInput.value = file.note || "";
  elements.tagsInput.value = (file.tags || []).join(", ");
  elements.favoriteBtn.textContent = file.favorite ? "取消收藏" : "加入收藏";
  elements.deleteBtn.classList.toggle("hidden", Boolean(file.deletedAt));
  elements.restoreBtn.classList.toggle("hidden", !file.deletedAt);
  elements.purgeBtn.classList.toggle("hidden", !file.deletedAt);

  renderPreviewMedia(file);

  if (window.innerWidth <= 720) {
    elements.previewPanel.scrollTop = 0;
  }
}

function closePreview() {
  appState.activeFileId = null;
  elements.previewPanel.classList.remove("is-open");
  elements.previewContent.classList.add("hidden");
  elements.previewEmpty.classList.remove("hidden");
  elements.previewMedia.innerHTML = "";
}

function updatePreview() {
  if (!appState.activeFileId) return;
  const file = getActiveFile(appState.activeFileId);
  if (!file) {
    closePreview();
    return;
  }
  openPreview(file.id);
}

async function renderPreviewMedia(file) {
  elements.previewMedia.innerHTML = "";

  if (file.group === "image") {
    const image = document.createElement("img");
    image.src = `/api/files/${file.id}/preview`;
    image.alt = file.originalName;
    image.loading = "lazy";
    elements.previewMedia.appendChild(image);
    return;
  }

  if (file.group === "video") {
    const video = document.createElement("video");
    video.src = `/api/files/${file.id}/preview`;
    video.controls = true;
    video.playsInline = true;
    elements.previewMedia.appendChild(video);
    return;
  }

  if (file.group === "text") {
    const pre = document.createElement("pre");
    try {
      const response = await fetch(`/api/files/${file.id}/preview`);
      pre.textContent = (await response.text()).slice(0, 20000) || "(空文件)";
    } catch (error) {
      pre.textContent = "文本预览暂时不可用，请直接下载原文件。";
    }
    elements.previewMedia.appendChild(pre);
    return;
  }

  if (file.mimeType === "application/pdf") {
    const frame = document.createElement("iframe");
    frame.src = `/api/files/${file.id}/preview`;
    frame.title = file.originalName;
    elements.previewMedia.appendChild(frame);
    return;
  }

  const fallback = document.createElement("div");
  fallback.className = "preview__empty";
  fallback.textContent = "这个文件类型暂不支持内嵌预览，但仍然可以直接下载原文件。";
  elements.previewMedia.appendChild(fallback);
}

async function saveActiveMetadata() {
  const file = getActiveFile();
  if (!file) return;

  await apiJson(`/api/files/${file.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: elements.noteInput.value,
      tags: elements.tagsInput.value,
    }),
  });

  toast("备注和标签已保存");
  await refreshFiles();
}

async function toggleActiveFavorite() {
  const file = getActiveFile();
  if (!file) return;

  await apiJson(`/api/files/${file.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorite: !file.favorite }),
  });

  toast(file.favorite ? "已取消收藏" : "已加入收藏");
  await refreshFiles();
}

function downloadActiveFile() {
  const file = getActiveFile();
  if (!file) return;
  triggerDownload(`/api/files/${file.id}/download`);
}

async function deleteActiveFile() {
  const file = getActiveFile();
  if (!file) return;
  if (!window.confirm(`确定将「${file.originalName}」移入回收站吗？`)) return;

  await apiJson(`/api/files/${file.id}`, { method: "DELETE" });
  toast("文件已移入回收站");
  await refreshFiles();
}

async function restoreActiveFile() {
  const file = getActiveFile();
  if (!file) return;

  await apiJson(`/api/files/${file.id}/restore`, { method: "POST" });
  toast("文件已恢复");
  await refreshFiles();
}

async function purgeActiveFile() {
  const file = getActiveFile();
  if (!file) return;
  if (!window.confirm(`永久删除「${file.originalName}」后无法恢复，确定继续吗？`)) return;

  await apiJson(`/api/files/${file.id}/permanent`, { method: "DELETE" });
  toast("文件已永久删除");
  await refreshFiles();
}

async function queueFiles(files) {
  if (!files.length) return;

  for (const file of files) {
    appState.uploadQueue.push({
      file,
      status: "等待上传",
      progress: 0,
      error: "",
    });
  }

  renderQueue();

  if (appState.uploading) return;

  appState.uploading = true;
  try {
    for (const item of appState.uploadQueue) {
      if (item.status === "上传完成") continue;
      item.status = "上传中";
      item.error = "";
      renderQueue();

      try {
        await uploadFileWithChunks(item);
        item.status = "上传完成";
        item.progress = 100;
        toast(`已上传：${item.file.name}`);
        await refreshFiles();
      } catch (error) {
        item.status = "上传失败";
        item.error = error.message || "上传失败";
      }

      renderQueue();
    }
  } finally {
    appState.uploading = false;
    appState.uploadQueue = appState.uploadQueue.filter((item) => item.status !== "上传完成");
    renderQueue();
  }
}

function renderQueue() {
  elements.queueList.innerHTML = "";

  if (!appState.uploadQueue.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.textContent = "当前没有正在处理的上传任务。你可以直接拖入文件，系统会自动进入上传队列。";
    elements.queueList.appendChild(empty);
    renderStats();
    return;
  }

  for (const item of appState.uploadQueue) {
    const fragment = queueItemTemplate.content.cloneNode(true);
    fragment.querySelector(".queueItem__name").textContent = item.file.name;
    fragment.querySelector(".queueItem__meta").textContent = [
      formatBytes(item.file.size),
      item.file.type || "application/octet-stream",
    ].join(" · ");
    fragment.querySelector(".queueItem__status").textContent =
      item.status === "上传失败" ? item.error : item.status;
    fragment.querySelector(".progress__bar").style.width = `${item.progress}%`;
    elements.queueList.appendChild(fragment);
  }

  renderStats();
}

async function uploadFileWithChunks(item, forceFresh = false) {
  const file = item.file;
  const chunkSize = 5 * 1024 * 1024;
  const fingerprint = `${file.name}::${file.size}::${file.lastModified}`;
  const session = await getUploadSession(file, fingerprint, chunkSize, forceFresh);
  const totalChunks = Math.max(1, Math.ceil(file.size / session.chunkSize));
  const uploadedChunks = new Set(session.receivedChunks || []);

  for (let index = 0; index < totalChunks; index += 1) {
    if (uploadedChunks.has(index)) {
      item.progress = Math.round((index / totalChunks) * 100);
      renderQueue();
      continue;
    }

    const start = index * session.chunkSize;
    const end = Math.min(start + session.chunkSize, file.size);
    const chunk = file.slice(start, end);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`/api/uploads/${session.uploadId}/chunks/${index}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: chunk,
      });

      if (response.ok) {
        uploadedChunks.add(index);
        saveLocalUploadSession(fingerprint, {
          ...session,
          name: file.name,
          size: file.size,
          receivedChunks: [...uploadedChunks],
        });
        item.progress = Math.round(((index + 1) / totalChunks) * 100);
        renderQueue();
        break;
      }

      if (response.status === 404) {
        clearLocalUploadSession(fingerprint);
        if (forceFresh) throw new Error("上传会话已失效");
        return uploadFileWithChunks(item, true);
      }

      const payload = await safeJson(response);
      if (attempt === 2) throw new Error(payload.error || "分块上传失败");
      await wait(300 * (attempt + 1));
    }
  }

  const completeResponse = await fetch(`/api/uploads/${session.uploadId}/complete`, {
    method: "POST",
  });

  if (!completeResponse.ok) {
    if (completeResponse.status === 404) {
      clearLocalUploadSession(fingerprint);
      if (forceFresh) throw new Error("上传会话已失效");
      return uploadFileWithChunks(item, true);
    }
    const payload = await safeJson(completeResponse);
    throw new Error(payload.error || "上传合并失败");
  }

  clearLocalUploadSession(fingerprint);
  return completeResponse.json();
}

async function getUploadSession(file, fingerprint, chunkSize, forceFresh = false) {
  if (!forceFresh) {
    const savedSession = loadLocalUploadSession(fingerprint);
    if (savedSession && savedSession.name === file.name && savedSession.size === file.size) {
      const statusResponse = await fetch(`/api/uploads/${savedSession.uploadId}/status`);
      if (statusResponse.ok) {
        const payload = await safeJson(statusResponse);
        const serverSession = payload.session || {};
        const session = {
          uploadId: savedSession.uploadId,
          chunkSize: serverSession.chunkSize || savedSession.chunkSize || chunkSize,
          totalChunks:
            serverSession.totalChunks ||
            savedSession.totalChunks ||
            Math.max(1, Math.ceil(file.size / chunkSize)),
          receivedChunks: serverSession.receivedChunks || savedSession.receivedChunks || [],
          name: file.name,
          size: file.size,
        };
        saveLocalUploadSession(fingerprint, session);
        return session;
      }
      clearLocalUploadSession(fingerprint);
    }
  } else {
    clearLocalUploadSession(fingerprint);
  }

  const initResponse = await fetch("/api/uploads/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      mimeType: file.type,
      lastModified: file.lastModified,
      deviceName: appState.deviceName || "当前设备",
      source: /Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "web",
      note: "",
      tags: [],
      chunkSize,
    }),
  });

  if (!initResponse.ok) {
    const payload = await safeJson(initResponse);
    throw new Error(payload.error || "上传初始化失败");
  }

  const session = await initResponse.json();
  const normalized = {
    ...session,
    name: file.name,
    size: file.size,
  };
  saveLocalUploadSession(fingerprint, normalized);
  return normalized;
}

function saveLocalUploadSession(fingerprint, session) {
  const sessions = JSON.parse(localStorage.getItem("vaultUploadSessions") || "{}");
  sessions[fingerprint] = session;
  localStorage.setItem("vaultUploadSessions", JSON.stringify(sessions));
}

function loadLocalUploadSession(fingerprint) {
  const sessions = JSON.parse(localStorage.getItem("vaultUploadSessions") || "{}");
  return sessions[fingerprint] || null;
}

function clearLocalUploadSession(fingerprint) {
  const sessions = JSON.parse(localStorage.getItem("vaultUploadSessions") || "{}");
  delete sessions[fingerprint];
  localStorage.setItem("vaultUploadSessions", JSON.stringify(sessions));
}

async function downloadSelectedFiles() {
  const ids = [...appState.selectedIds];
  if (!ids.length) {
    toast("请先勾选要下载的文件");
    return;
  }

  for (const id of ids) {
    triggerDownload(`/api/files/${id}/download`);
    await wait(180);
  }

  toast(`已发起 ${ids.length} 个下载任务`);
}

async function deleteSelectedFiles() {
  const ids = [...appState.selectedIds];
  if (!ids.length) {
    toast("请先勾选要删除的文件");
    return;
  }

  if (!window.confirm(`确定把 ${ids.length} 个文件移入回收站吗？`)) return;

  await apiJson("/api/files/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

  appState.selectedIds.clear();
  toast("批量删除完成");
  await refreshFiles();
}

function getActiveFile(fileId = appState.activeFileId) {
  return appState.files.find((file) => file.id === fileId) || null;
}

function triggerDownload(url) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 2200);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
