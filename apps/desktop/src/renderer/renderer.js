const state = {
  authorized: false,
  messages: [],
  files: [],
  messageQuery: "",
  fileQuery: "",
  timers: [],
};

const $ = (id) => document.getElementById(id);

const elements = {
  authView: $("authView"),
  mainView: $("mainView"),
  accessCodeInput: $("accessCodeInput"),
  unlockBtn: $("unlockBtn"),
  authError: $("authError"),
  serverHint: $("serverHint"),
  deviceNameInput: $("deviceNameInput"),
  pinBtn: $("pinBtn"),
  openWebBtn: $("openWebBtn"),
  messageSearchInput: $("messageSearchInput"),
  messageList: $("messageList"),
  messageForm: $("messageForm"),
  messageInput: $("messageInput"),
  sendBtn: $("sendBtn"),
  fileSearchInput: $("fileSearchInput"),
  uploadBtn: $("uploadBtn"),
  refreshFilesBtn: $("refreshFilesBtn"),
  uploadStatus: $("uploadStatus"),
  fileList: $("fileList"),
  lockBtn: $("lockBtn"),
  syncHint: $("syncHint"),
};

init();

async function init() {
  bindEvents();
  await checkAuth();
}

function bindEvents() {
  elements.unlockBtn.addEventListener("click", unlock);
  elements.accessCodeInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    unlock();
  });

  elements.messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
  });

  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    sendMessage();
  });

  elements.messageSearchInput.addEventListener("input", debounce(() => {
    state.messageQuery = elements.messageSearchInput.value.trim();
    loadMessages();
  }, 180));

  elements.fileSearchInput.addEventListener("input", debounce(() => {
    state.fileQuery = elements.fileSearchInput.value.trim();
    loadFiles();
  }, 180));

  elements.uploadBtn.addEventListener("click", uploadFiles);
  elements.refreshFilesBtn.addEventListener("click", loadFiles);
  elements.lockBtn.addEventListener("click", lock);
  elements.pinBtn.addEventListener("click", toggleAlwaysOnTop);
  elements.openWebBtn.addEventListener("click", () => window.vault.openWeb());

  elements.deviceNameInput.addEventListener("change", async () => {
    await window.vault.setDeviceName(elements.deviceNameInput.value.trim() || "Windows 桌面端");
  });

  window.vault.onUploadProgress((payload) => {
    elements.uploadStatus.textContent = `${payload.name} 上传中 ${payload.progress}%`;
  });
}

async function checkAuth() {
  try {
    const status = await window.vault.authStatus();
    elements.serverHint.textContent = new URL(status.baseUrl).host;
    elements.deviceNameInput.value = status.deviceName || "Windows 桌面端";
    elements.pinBtn.textContent = status.alwaysOnTop ? "置顶中" : "置顶";
    if (status.authorized) {
      showMain();
      await refreshAll();
      startPolling();
      return;
    }
  } catch (error) {
    elements.authError.textContent = "无法连接服务端，请稍后重试";
  }
  showAuth();
}

function showAuth() {
  state.authorized = false;
  elements.authView.classList.remove("hidden");
  elements.mainView.classList.add("hidden");
  elements.accessCodeInput.focus();
}

function showMain() {
  state.authorized = true;
  elements.authView.classList.add("hidden");
  elements.mainView.classList.remove("hidden");
  elements.messageInput.focus();
}

async function unlock() {
  const code = elements.accessCodeInput.value.trim();
  if (!code) {
    elements.authError.textContent = "请输入访问码";
    return;
  }

  elements.unlockBtn.disabled = true;
  try {
    await window.vault.unlock(code);
    elements.authError.textContent = "";
    showMain();
    await refreshAll();
    startPolling();
  } catch (error) {
    elements.authError.textContent = "访问码不正确";
  } finally {
    elements.unlockBtn.disabled = false;
  }
}

async function lock() {
  await window.vault.lock();
  clearPolling();
  showAuth();
}

async function refreshAll() {
  await Promise.all([loadMessages(), loadFiles()]);
}

function startPolling() {
  clearPolling();
  state.timers.push(setInterval(loadMessages, 2000));
  state.timers.push(setInterval(loadFiles, 6000));
}

function clearPolling() {
  for (const timer of state.timers) clearInterval(timer);
  state.timers = [];
}

async function loadMessages() {
  if (!state.authorized) return;
  try {
    const payload = await window.vault.getMessages(state.messageQuery);
    state.messages = payload.messages || [];
    renderMessages();
    elements.syncHint.textContent = `已同步 ${formatTime(new Date())}`;
  } catch (error) {
    elements.syncHint.textContent = "同步失败";
  }
}

function renderMessages() {
  elements.messageList.innerHTML = "";
  if (!state.messages.length) {
    elements.messageList.innerHTML = '<div class="empty">暂无对话记录</div>';
    return;
  }

  for (const message of state.messages) {
    const item = document.createElement("article");
    item.className = "message";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.text || "";

    const meta = document.createElement("div");
    meta.className = "messageMeta";
    meta.textContent = `${formatMessageDate(message.createdAt)} ${formatTime(message.createdAt)} · ${message.deviceName || "设备"}`;

    const tools = document.createElement("div");
    tools.className = "messageTools";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "复制";
    copy.addEventListener("click", () => window.vault.copyText(message.text || ""));
    tools.appendChild(copy);

    item.appendChild(bubble);
    item.appendChild(meta);
    item.appendChild(tools);
    elements.messageList.appendChild(item);
  }

  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

async function sendMessage() {
  const text = elements.messageInput.value.trimEnd();
  if (!text.trim()) return;

  elements.sendBtn.disabled = true;
  try {
    await window.vault.sendMessage(text);
    elements.messageInput.value = "";
    await loadMessages();
  } finally {
    elements.sendBtn.disabled = false;
  }
}

async function loadFiles() {
  if (!state.authorized) return;
  try {
    const payload = await window.vault.listFiles(state.fileQuery);
    state.files = (payload.files || []).filter((file) => file.source !== "text-note").slice(0, 30);
    renderFiles();
  } catch (error) {
    elements.fileList.innerHTML = '<div class="empty">文件加载失败</div>';
  }
}

function renderFiles() {
  elements.fileList.innerHTML = "";
  if (!state.files.length) {
    elements.fileList.innerHTML = '<div class="empty">暂无文件，点击上传文件加入仓库</div>';
    return;
  }

  for (const file of state.files) {
    const card = document.createElement("article");
    card.className = "fileCard";

    const title = document.createElement("strong");
    title.textContent = file.originalName;
    const meta = document.createElement("small");
    meta.textContent = `${formatBytes(file.size)} · ${file.groupLabel || file.mimeType || "文件"} · ${formatTime(file.uploadedAt)}`;

    const actions = document.createElement("div");
    actions.className = "fileCard__actions";
    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "下载";
    download.addEventListener("click", async () => {
      await window.vault.downloadFile({ id: file.id, originalName: file.originalName });
    });
    actions.appendChild(download);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(actions);
    elements.fileList.appendChild(card);
  }
}

async function uploadFiles() {
  elements.uploadBtn.disabled = true;
  elements.uploadStatus.textContent = "选择文件后开始上传";
  try {
    const result = await window.vault.uploadFiles();
    const count = result.uploaded?.length || 0;
    elements.uploadStatus.textContent = count ? `上传完成：${count} 个文件` : "未选择文件";
    await loadFiles();
  } catch (error) {
    elements.uploadStatus.textContent = error.message || "上传失败";
  } finally {
    elements.uploadBtn.disabled = false;
  }
}

async function toggleAlwaysOnTop() {
  const result = await window.vault.toggleAlwaysOnTop();
  elements.pinBtn.textContent = result.alwaysOnTop ? "置顶中" : "置顶";
}

function debounce(callback, delay) {
  let timer = 0;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(callback, delay);
  };
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value ? new Date(value) : new Date());
}

function formatMessageDate(value) {
  const date = value ? new Date(value) : new Date();
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "今天";
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
}
