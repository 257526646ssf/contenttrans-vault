const { app, BrowserWindow, clipboard, dialog, ipcMain, net, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const VAULT_BASE_URL = (process.env.VAULT_BASE_URL || "https://contenttrans-vault-production.up.railway.app").replace(/\/+$/, "");
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

let mainWindow = null;
let settingsPath = "";
let settings = {
  token: "",
  deviceName: "Windows 桌面端",
};

function loadSettings() {
  settingsPath = path.join(app.getPath("userData"), "settings.json");
  try {
    settings = {
      ...settings,
      ...JSON.parse(fs.readFileSync(settingsPath, "utf8")),
    };
  } catch (error) {
    saveSettings();
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 430,
    height: 680,
    minWidth: 340,
    minHeight: 460,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#06070c",
    title: "Vault One Desk",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

async function vaultFetch(endpoint, options = {}) {
  const headers = new Headers(options.headers || {});
  if (settings.token && !headers.has("X-Vault-Token")) headers.set("X-Vault-Token", settings.token);

  const response = await net.fetch(`${VAULT_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    settings.token = "";
    saveSettings();
  }

  return response;
}

async function vaultJson(endpoint, options = {}) {
  const response = await vaultFetch(endpoint, options);
  let payload = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".webm": "video/webm",
      ".pdf": "application/pdf",
      ".txt": "text/plain; charset=utf-8",
      ".md": "text/markdown; charset=utf-8",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".zip": "application/zip",
      ".rar": "application/vnd.rar",
      ".7z": "application/x-7z-compressed",
    }[ext] || "application/octet-stream"
  );
}

async function uploadFile(filePath, sender) {
  const stat = fs.statSync(filePath);
  const name = path.basename(filePath);
  const init = await vaultJson("/api/uploads/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      size: stat.size,
      mimeType: contentTypeFor(filePath),
      lastModified: stat.mtimeMs,
      deviceName: settings.deviceName || "Windows 桌面端",
      source: "desktop",
      chunkSize: DEFAULT_CHUNK_SIZE,
    }),
  });

  const fd = fs.openSync(filePath, "r");
  try {
    for (let index = 0; index < init.totalChunks; index += 1) {
      const start = index * init.chunkSize;
      const size = Math.min(init.chunkSize, stat.size - start);
      const buffer = Buffer.alloc(size);
      fs.readSync(fd, buffer, 0, size, start);

      const response = await vaultFetch(`/api/uploads/${init.uploadId}/chunks/${index}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: buffer,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `${name} 上传失败`);
      }

      sender.send("upload-progress", {
        name,
        progress: Math.round(((index + 1) / init.totalChunks) * 100),
      });
    }
  } finally {
    fs.closeSync(fd);
  }

  const complete = await vaultJson(`/api/uploads/${init.uploadId}/complete`, { method: "POST" });
  return complete.file;
}

function registerIpc() {
  ipcMain.handle("auth-status", async () => {
    const payload = await vaultJson("/api/auth/status");
    return {
      ...payload,
      baseUrl: VAULT_BASE_URL,
      deviceName: settings.deviceName,
      alwaysOnTop: mainWindow ? mainWindow.isAlwaysOnTop() : true,
    };
  });

  ipcMain.handle("unlock", async (_event, code) => {
    const payload = await vaultJson("/api/auth/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (payload.token) {
      settings.token = payload.token;
      saveSettings();
    }
    return { ok: true };
  });

  ipcMain.handle("lock", async () => {
    settings.token = "";
    saveSettings();
    return { ok: true };
  });

  ipcMain.handle("get-messages", async (_event, query = "") => {
    const params = new URLSearchParams({ limit: "200", q: query });
    return vaultJson(`/api/text-notes?${params.toString()}`);
  });

  ipcMain.handle("send-message", async (_event, text) => {
    return vaultJson("/api/text-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        deviceName: settings.deviceName || "Windows 桌面端",
        note: "对话记录",
        tags: ["对话记录", "桌面端"],
      }),
    });
  });

  ipcMain.handle("copy-text", (_event, text) => {
    clipboard.writeText(String(text || ""));
    return { ok: true };
  });

  ipcMain.handle("list-files", async (_event, query = "") => {
    const params = new URLSearchParams({
      includeDeleted: "false",
      type: "all",
      sort: "uploadedAt",
      order: "desc",
      q: query,
    });
    return vaultJson(`/api/files?${params.toString()}`);
  });

  ipcMain.handle("upload-files", async (event) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      title: "选择要上传到 Vault One 的文件",
    });
    if (result.canceled || !result.filePaths.length) return { uploaded: [] };

    const uploaded = [];
    for (const filePath of result.filePaths) {
      uploaded.push(await uploadFile(filePath, event.sender));
    }
    return { uploaded };
  });

  ipcMain.handle("upload-file-paths-for-test", async (event, filePaths) => {
    if (process.env.VAULT_DESKTOP_TEST !== "1") throw new Error("Test upload is disabled");
    const uploaded = [];
    for (const filePath of filePaths || []) {
      uploaded.push(await uploadFile(filePath, event.sender));
    }
    return { uploaded };
  });

  ipcMain.handle("download-file", async (_event, file) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: file.originalName || "download",
      title: "保存文件",
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    const response = await vaultFetch(`/api/files/${file.id}/download`);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "下载失败");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(result.filePath, buffer);
    shell.showItemInFolder(result.filePath);
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle("download-file-to-path-for-test", async (_event, file, targetPath) => {
    if (process.env.VAULT_DESKTOP_TEST !== "1") throw new Error("Test download is disabled");
    const response = await vaultFetch(`/api/files/${file.id}/download`);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "下载失败");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(targetPath, buffer);
    return { ok: true, path: targetPath, size: buffer.length };
  });

  ipcMain.handle("set-device-name", (_event, deviceName) => {
    settings.deviceName = String(deviceName || "Windows 桌面端").slice(0, 120);
    saveSettings();
    return { ok: true, deviceName: settings.deviceName };
  });

  ipcMain.handle("toggle-always-on-top", () => {
    const next = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(next, "screen-saver");
    return { alwaysOnTop: next };
  });

  ipcMain.handle("open-web", () => {
    shell.openExternal(VAULT_BASE_URL);
    return { ok: true };
  });
}

app.whenReady().then(() => {
  loadSettings();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
