const appState = {
  files: [],
  filteredFiles: [],
  stats: {
    total: 0,
    size: 0,
    favorites: 0,
    counts: {},
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
};

const elements = {
  statTotal: document.getElementById("statTotal"),
  statSize: document.getElementById("statSize"),
  statFav: document.getElementById("statFav"),
  resultHint: document.getElementById("resultHint"),
  fileList: document.getElementById("fileList"),
  queueList: document.getElementById("queueList"),
  queueHint: document.getElementById("queueHint"),
  typeTabs: document.getElementById("typeTabs"),
  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),
  orderBtn: document.getElementById("orderBtn"),
  uploadBtn: document.getElementById("uploadBtn"),
  fileInput: document.getElementById("fileInput"),
  batchDownloadBtn: document.getElementById("batchDownloadBtn"),
  batchDeleteBtn: document.getElementById("batchDeleteBtn"),
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
};

const fileCardTemplate = document.getElementById("fileCardTemplate");
const queueItemTemplate = document.getElementById("queueItemTemplate");

const typeTabs = [
  { key: "all", label: "全部" },
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
  { key: "document", label: "文档" },
  { key: "text", label: "文本" },
  { key: "other", label: "其他" },
  { key: "favorite", label: "收藏" },
  { key: "trash", label: "回收站" },
];

const groupIcons = {
  image: "I",
  video: "V",
  document: "D",
  text: "T",
  other: "F",
};

boot();

async function boot() {
  elements.deviceName.value = appState.deviceName;
  bindEvents();
  renderTabs();
  await refreshFiles();
  renderQueue();
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
  elements.fileInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    await queueFiles(files);
    event.target.value = "";
  });

  elements.batchDownloadBtn.addEventListener("click", downloadSelectedFiles);
  elements.batchDeleteBtn.addEventListener("click", deleteSelectedFiles);
  elements.closePreviewBtn.addEventListener("click", closePreview);
  elements.saveMetaBtn.addEventListener("click", saveActiveMetadata);
  elements.favoriteBtn.addEventListener("click", toggleActiveFavorite);
  elements.downloadBtn.addEventListener("click", downloadActiveFile);
  elements.deleteBtn.addEventListener("click", deleteActiveFile);
  elements.restoreBtn.addEventListener("click", restoreActiveFile);
  elements.purgeBtn.addEventListener("click", purgeActiveFile);

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

function renderTabs() {
  elements.typeTabs.innerHTML = "";
  for (const tab of typeTabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab ${tab.key === appState.activeType ? "is-active" : ""}`;
    button.textContent = tab.label;
    button.addEventListener("click", async () => {
      appState.activeType = tab.key;
      renderTabs();
      await refreshFiles();
    });
    elements.typeTabs.appendChild(button);
  }
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
  appState.stats = data.stats || appState.stats;
  appState.filteredFiles = filterFilesForView();

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

    if (appState.query) {
      const blob = [
        file.originalName,
        file.note,
        ...(file.tags || []),
        file.deviceName,
        file.groupLabel,
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(appState.query.toLowerCase());
    }

    return true;
  });
}

function renderStats() {
  elements.statTotal.textContent = String(appState.stats.total || 0);
  elements.statSize.textContent = formatBytes(appState.stats.size || 0);
  elements.statFav.textContent = String(appState.stats.favorites || 0);
  elements.resultHint.textContent = `${appState.filteredFiles.length} 个文件`;
  elements.queueHint.textContent = appState.uploadQueue.length
    ? `${appState.uploadQueue.length} 个文件待上传`
    : "拖拽文件到这里，或点击上传按钮";
}

function renderFileList() {
  elements.fileList.innerHTML = "";

  if (!appState.filteredFiles.length) {
    const empty = document.createElement("div");
    empty.className = "preview__empty";
    empty.textContent = "这里还没有文件。先上传一个图片、视频或文档。";
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

    icon.textContent = groupIcons[file.group] || "F";
    title.textContent = file.originalName;
    meta.textContent = `${formatDate(file.uploadedAt)} · ${formatBytes(file.size)} · ${file.groupLabel} · ${file.deviceName || "未知设备"}`;
    favorite.textContent = file.favorite ? "★" : "☆";
    checkbox.checked = appState.selectedIds.has(file.id);
    card.classList.toggle("is-selected", checkbox.checked);

    const labels = [];
    if (file.favorite) labels.push("收藏");
    if (file.deletedAt) labels.push("已删除");
    for (const tag of (file.tags || []).slice(0, 3)) labels.push(tag);
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
  elements.favoriteBtn.textContent = file.favorite ? "取消收藏" : "收藏";
  elements.deleteBtn.classList.toggle("hidden", Boolean(file.deletedAt));
  elements.restoreBtn.classList.toggle("hidden", !file.deletedAt);
  elements.purgeBtn.classList.toggle("hidden", !file.deletedAt);

  renderPreviewMedia(file);

  if (window.innerWidth <= 900) {
    elements.previewPanel.scrollTop = 0;
  }
}

function closePreview() {
  elements.previewPanel.classList.remove("is-open");
}

function updatePreview() {
  if (!appState.activeFileId) return;
  const file = getActiveFile(appState.activeFileId);
  if (!file) {
    appState.activeFileId = null;
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
      pre.textContent = (await response.text()).slice(0, 20000) || "(空文本)";
    } catch {
      pre.textContent = "文本预览不可用，请直接下载。";
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
  fallback.textContent = "这个文件类型暂不提供内嵌预览，可以直接下载。";
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

  toast("已保存备注和标签");
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

  toast(file.favorite ? "已取消收藏" : "已收藏");
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
  toast("已移入回收站");
  await refreshFiles();
}

async function restoreActiveFile() {
  const file = getActiveFile();
  if (!file) return;

  await apiJson(`/api/files/${file.id}/restore`, { method: "POST" });
  toast("已恢复文件");
  await refreshFiles();
}

async function purgeActiveFile() {
  const file = getActiveFile();
  if (!file) return;
  if (!window.confirm(`永久删除「${file.originalName}」后无法恢复，确定继续吗？`)) return;

  await apiJson(`/api/files/${file.id}/permanent`, { method: "DELETE" });
  toast("已永久删除");
  await refreshFiles();
}

async function queueFiles(files) {
  if (!files.length) return;

  for (const file of files) {
    appState.uploadQueue.push({
      file,
      status: "waiting",
      progress: 0,
      error: "",
    });
  }

  renderQueue();

  if (appState.uploading) return;

  appState.uploading = true;
  try {
    for (const item of appState.uploadQueue) {
      if (item.status === "done") continue;
      item.status = "uploading";
      item.error = "";
      renderQueue();

      try {
        await uploadFileWithChunks(item);
        item.status = "done";
        item.progress = 100;
        toast(`已上传：${item.file.name}`);
        await refreshFiles();
      } catch (error) {
        item.status = "error";
        item.error = error.message || "上传失败";
      }

      renderQueue();
    }
  } finally {
    appState.uploading = false;
    appState.uploadQueue = appState.uploadQueue.filter((item) => item.status !== "done");
    renderQueue();
  }
}

function renderQueue() {
  elements.queueList.innerHTML = "";

  if (!appState.uploadQueue.length) {
    const empty = document.createElement("div");
    empty.className = "preview__empty";
    empty.textContent = "没有正在上传的文件。";
    elements.queueList.appendChild(empty);
    renderStats();
    return;
  }

  for (const item of appState.uploadQueue) {
    const fragment = queueItemTemplate.content.cloneNode(true);
    fragment.querySelector(".queueItem__name").textContent = item.file.name;
    fragment.querySelector(".queueItem__meta").textContent =
      `${formatBytes(item.file.size)} · ${item.file.type || "application/octet-stream"}`;
    fragment.querySelector(".queueItem__status").textContent =
      item.status === "error" ? item.error : item.status;
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
        if (forceFresh) {
          throw new Error("Upload session expired");
        }
        return uploadFileWithChunks(item, true);
      }

      const payload = await safeJson(response);
      if (attempt === 2) {
        throw new Error(payload.error || "Chunk upload failed");
      }
      await wait(250 * (attempt + 1));
    }
  }

  const completeResponse = await fetch(`/api/uploads/${session.uploadId}/complete`, {
    method: "POST",
  });

  if (!completeResponse.ok) {
    if (completeResponse.status === 404) {
      clearLocalUploadSession(fingerprint);
      if (forceFresh) {
        throw new Error("Upload session expired");
      }
      return uploadFileWithChunks(item, true);
    }
    const payload = await safeJson(completeResponse);
    throw new Error(payload.error || "Upload finalize failed");
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
      deviceName: appState.deviceName || "This device",
      source: /Android/i.test(navigator.userAgent) ? "mobile" : "web",
      note: "",
      tags: [],
      chunkSize,
    }),
  });

  if (!initResponse.ok) {
    const payload = await safeJson(initResponse);
    throw new Error(payload.error || "Upload init failed");
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
    toast("先勾选要下载的文件");
    return;
  }

  for (const id of ids) {
    triggerDownload(`/api/files/${id}/download`);
    await wait(180);
  }

  toast(`已发起 ${ids.length} 个下载`);
}

async function deleteSelectedFiles() {
  const ids = [...appState.selectedIds];
  if (!ids.length) {
    toast("先勾选要删除的文件");
    return;
  }

  if (!window.confirm(`确定将 ${ids.length} 个文件移入回收站吗？`)) return;

  await apiJson("/api/files/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

  appState.selectedIds.clear();
  toast("已批量删除");
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
  } catch {
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
