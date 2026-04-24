const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STORAGE_DIR = path.join(ROOT, "storage");
const FILE_DIR = path.join(STORAGE_DIR, "files");
const TEMP_DIR = path.join(STORAGE_DIR, "tmp");
const STATE_FILE = path.join(DATA_DIR, "vault.json");
const UPLOAD_FILE = path.join(DATA_DIR, "uploads.json");
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

ensureDirSync(DATA_DIR);
ensureDirSync(STORAGE_DIR);
ensureDirSync(FILE_DIR);
ensureDirSync(TEMP_DIR);

const state = loadJson(STATE_FILE, {
  version: 1,
  files: [],
});

const uploadSessions = loadJson(UPLOAD_FILE, {
  version: 1,
  sessions: {},
});

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return structuredClone(fallback);
    return Object.assign(structuredClone(fallback), JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    console.warn(`Failed to load ${filePath}: ${error.message}`);
    return structuredClone(fallback);
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function persistState() {
  saveJson(STATE_FILE, state);
}

function persistUploads() {
  saveJson(UPLOAD_FILE, uploadSessions);
}

function nowIso() {
  return new Date().toISOString();
}

function safeId() {
  return crypto.randomUUID();
}

function safeExt(filename) {
  return path.extname(filename || "").slice(0, 16).toLowerCase();
}

function normalizeName(name) {
  return String(name || "未命名文件").replace(/[\\/:*?"<>|]+/g, "_").trim() || "未命名文件";
}

function extToGroup(ext, mimeType = "") {
  const imageExt = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif", ".heic", ".heif"]);
  const videoExt = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".wmv", ".flv"]);
  const textExt = new Set([".txt", ".md", ".json", ".csv", ".log", ".yaml", ".yml", ".xml"]);
  const docExt = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf", ".odt", ".ods", ".odp"]);

  if (mimeType.startsWith("image/") || imageExt.has(ext)) return "image";
  if (mimeType.startsWith("video/") || videoExt.has(ext)) return "video";
  if (mimeType.startsWith("text/") || mimeType === "application/json" || textExt.has(ext)) return "text";
  if (
    mimeType === "application/pdf" ||
    mimeType.includes("msword") ||
    mimeType.includes("officedocument") ||
    docExt.has(ext)
  ) {
    return "document";
  }
  return "other";
}

function fileCategoryLabel(group) {
  return ({
    image: "图片",
    video: "视频",
    text: "文本",
    document: "文档",
    other: "其他",
  })[group] || "其他";
}

function parseTags(input) {
  if (Array.isArray(input)) return input.map((item) => String(item).trim()).filter(Boolean);
  if (typeof input === "string") {
    return input
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function getFileById(id) {
  return state.files.find((file) => file.id === id) || null;
}

function serializeFile(file) {
  return {
    id: file.id,
    originalName: file.originalName,
    storedName: file.storedName,
    mimeType: file.mimeType,
    ext: file.ext,
    group: file.group,
    groupLabel: file.groupLabel,
    size: file.size,
    uploadedAt: file.uploadedAt,
    deviceName: file.deviceName,
    source: file.source,
    note: file.note || "",
    tags: file.tags || [],
    favorite: Boolean(file.favorite),
    deletedAt: file.deletedAt || null,
    previewable: Boolean(file.previewable),
  };
}

function getStats() {
  const visible = state.files.filter((file) => !file.deletedAt);
  const trash = state.files.filter((file) => Boolean(file.deletedAt));
  const bytes = visible.reduce((sum, file) => sum + (file.size || 0), 0);
  const groups = ["image", "video", "text", "document", "other"];
  const counts = Object.fromEntries(groups.map((group) => [group, 0]));
  for (const file of visible) counts[file.group] = (counts[file.group] || 0) + 1;
  return {
    total: visible.length,
    trash: trash.length,
    favorites: visible.filter((file) => file.favorite).length,
    size: bytes,
    counts,
  };
}

function getVisibleFiles(query) {
  const q = String(query.q || "").trim().toLowerCase();
  const type = String(query.type || "all");
  const includeDeleted = String(query.includeDeleted || "false") === "true";
  const sort = String(query.sort || "uploadedAt");
  const order = String(query.order || "desc") === "desc" ? -1 : 1;

  let files = state.files.filter((file) => includeDeleted || !file.deletedAt);

  if (type !== "all") {
    files = files.filter((file) => {
      if (type === "favorite") return file.favorite && !file.deletedAt;
      if (type === "trash") return Boolean(file.deletedAt);
      return file.group === type;
    });
  }

  if (q) {
    files = files.filter((file) => {
      const haystack = [
        file.originalName,
        file.note,
        ...(file.tags || []),
        file.deviceName,
        file.groupLabel,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  files.sort((a, b) => {
    let result = 0;
    if (sort === "size") result = (a.size || 0) - (b.size || 0);
    else if (sort === "name") result = a.originalName.localeCompare(b.originalName, "zh-Hans-CN");
    else if (sort === "favorite") result = Number(a.favorite) - Number(b.favorite);
    else result = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
    return result * order;
  });

  return files;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(ROOT, "public", requested);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(path.join(ROOT, "public"))) {
    sendJson(res, 403, { error: "Forbidden" });
    return true;
  }
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) return false;
  const ext = path.extname(normalized).toLowerCase();
  const type = mimeTypes[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(normalized).pipe(res);
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  return JSON.parse(raw.toString("utf8"));
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function chunkPath(session, index) {
  return path.join(session.sessionDir, `${String(index).padStart(6, "0")}.part`);
}

function purgeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFileBuffer(filePath, buffer) {
  fs.writeFileSync(filePath, buffer);
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, time: nowIso(), stats: getStats() });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/files") {
    sendJson(res, 200, { files: getVisibleFiles(Object.fromEntries(url.searchParams)), stats: getStats() });
    return true;
  }

  if (req.method === "GET" && pathname.startsWith("/api/files/")) {
    const parts = pathname.split("/").filter(Boolean);
    const id = parts[2];
    const action = parts[3];
    const file = getFileById(id);

    if (!file) {
      notFound(res);
      return true;
    }

    if (!action) {
      sendJson(res, 200, { file: serializeFile(file) });
      return true;
    }

    const fullPath = path.join(FILE_DIR, file.storedName);
    if (!fs.existsSync(fullPath)) {
      sendJson(res, 404, { error: "File content missing" });
      return true;
    }

    if (action === "download") {
      res.writeHead(200, {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      });
      fs.createReadStream(fullPath).pipe(res);
      return true;
    }

    if (action === "preview") {
      res.writeHead(200, {
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      });
      fs.createReadStream(fullPath).pipe(res);
      return true;
    }

    return false;
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/files/")) {
    const id = pathname.split("/").filter(Boolean)[2];
    const file = getFileById(id);
    if (!file) {
      notFound(res);
      return true;
    }
    const body = await readJsonBody(req);
    const { name, note, tags, favorite } = body || {};
    if (typeof name === "string" && name.trim()) file.originalName = normalizeName(name.trim());
    if (typeof note === "string") file.note = note.slice(0, 5000);
    if (tags !== undefined) file.tags = parseTags(tags).slice(0, 30);
    if (favorite !== undefined) file.favorite = Boolean(favorite);
    file.updatedAt = nowIso();
    persistState();
    sendJson(res, 200, { file: serializeFile(file) });
    return true;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/files/")) {
    const parts = pathname.split("/").filter(Boolean);
    const id = parts[2];
    const action = parts[3];
    const index = state.files.findIndex((file) => file.id === id);
    if (index === -1) {
      notFound(res);
      return true;
    }
    const file = state.files[index];

    if (!action) {
      file.deletedAt = nowIso();
      file.updatedAt = nowIso();
      persistState();
      sendJson(res, 200, { ok: true, file: serializeFile(file) });
      return true;
    }

    if (action === "permanent") {
      const fullPath = path.join(FILE_DIR, file.storedName);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      state.files.splice(index, 1);
      persistState();
      sendJson(res, 200, { ok: true });
      return true;
    }

    return false;
  }

  if (req.method === "POST" && pathname.startsWith("/api/files/")) {
    const parts = pathname.split("/").filter(Boolean);
    const id = parts[2];
    const action = parts[3];
    const file = getFileById(id);
    if (!file) {
      notFound(res);
      return true;
    }

    if (action === "restore") {
      file.deletedAt = null;
      file.updatedAt = nowIso();
      persistState();
      sendJson(res, 200, { ok: true, file: serializeFile(file) });
      return true;
    }

    return false;
  }

  if (req.method === "POST" && pathname === "/api/files/bulk-delete") {
    const body = await readJsonBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const affected = [];
    for (const id of ids) {
      const file = getFileById(id);
      if (file && !file.deletedAt) {
        file.deletedAt = nowIso();
        file.updatedAt = nowIso();
        affected.push(id);
      }
    }
    persistState();
    sendJson(res, 200, { ok: true, affected });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/files/bulk-restore") {
    const body = await readJsonBody(req);
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const affected = [];
    for (const id of ids) {
      const file = getFileById(id);
      if (file && file.deletedAt) {
        file.deletedAt = null;
        file.updatedAt = nowIso();
        affected.push(id);
      }
    }
    persistState();
    sendJson(res, 200, { ok: true, affected });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/uploads/init") {
    const body = await readJsonBody(req);
    const {
      name,
      size,
      mimeType,
      lastModified,
      deviceName = "未命名设备",
      source = "web",
      note = "",
      tags = [],
      chunkSize = DEFAULT_CHUNK_SIZE,
      uploadId = "",
    } = body || {};

    const finalUploadId = uploadId || safeId();
    const sessionDir = path.join(TEMP_DIR, finalUploadId);
    ensureDirSync(sessionDir);

    const numericSize = Number(size) || 0;
    const numericChunkSize = Math.max(1024 * 1024, Number(chunkSize) || DEFAULT_CHUNK_SIZE);
    const totalChunks = Math.max(1, Math.ceil(numericSize / numericChunkSize));
    const existing = uploadSessions.sessions[finalUploadId];
    const session = existing || {
      id: finalUploadId,
      createdAt: nowIso(),
      status: "active",
      receivedChunks: [],
    };

    Object.assign(session, {
      name: normalizeName(name),
      size: numericSize,
      mimeType: mimeType || "application/octet-stream",
      lastModified: Number(lastModified) || Date.now(),
      deviceName: String(deviceName).slice(0, 120),
      source: String(source).slice(0, 40),
      note: String(note).slice(0, 5000),
      tags: parseTags(tags).slice(0, 30),
      chunkSize: numericChunkSize,
      totalChunks,
      sessionDir,
      updatedAt: nowIso(),
    });

    uploadSessions.sessions[finalUploadId] = session;
    persistUploads();
    sendJson(res, 200, {
      uploadId: finalUploadId,
      chunkSize: numericChunkSize,
      totalChunks,
      receivedChunks: session.receivedChunks || [],
    });
    return true;
  }

  if (req.method === "GET" && pathname.startsWith("/api/uploads/") && pathname.endsWith("/status")) {
    const id = pathname.split("/").filter(Boolean)[2];
    const session = uploadSessions.sessions[id];
    if (!session) {
      notFound(res);
      return true;
    }
    sendJson(res, 200, { session: { ...session, receivedChunks: session.receivedChunks || [] } });
    return true;
  }

  if (req.method === "POST" && pathname.startsWith("/api/uploads/") && pathname.includes("/chunks/")) {
    const parts = pathname.split("/").filter(Boolean);
    const id = parts[2];
    const index = Number(parts[4]);
    const session = uploadSessions.sessions[id];
    if (!session) {
      notFound(res);
      return true;
    }
    if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
      sendJson(res, 400, { error: "Invalid chunk index" });
      return true;
    }
    const body = await readBody(req);
    if (!body.length) {
      sendJson(res, 400, { error: "Empty chunk body" });
      return true;
    }

    writeFileBuffer(chunkPath(session, index), body);
    const received = new Set(session.receivedChunks || []);
    received.add(index);
    session.receivedChunks = [...received].sort((a, b) => a - b);
    session.updatedAt = nowIso();
    uploadSessions.sessions[id] = session;
    persistUploads();
    sendJson(res, 200, { ok: true, index });
    return true;
  }

  if (req.method === "POST" && pathname.startsWith("/api/uploads/") && pathname.endsWith("/complete")) {
    const id = pathname.split("/").filter(Boolean)[2];
    const session = uploadSessions.sessions[id];
    if (!session) {
      notFound(res);
      return true;
    }

    const received = new Set(session.receivedChunks || []);
    const missing = [];
    for (let i = 0; i < session.totalChunks; i += 1) {
      if (!received.has(i)) missing.push(i);
    }
    if (missing.length) {
      sendJson(res, 400, { error: "Missing chunks", missing });
      return true;
    }

    const fileId = safeId();
    const ext = safeExt(session.name);
    const storedName = `${fileId}${ext}`;
    const finalPath = path.join(FILE_DIR, storedName);
    const fd = fs.openSync(finalPath, "w");
    for (let i = 0; i < session.totalChunks; i += 1) {
      const buffer = fs.readFileSync(chunkPath(session, i));
      fs.writeSync(fd, buffer);
    }
    fs.closeSync(fd);

    const group = extToGroup(ext, session.mimeType);
    const fileRecord = {
      id: fileId,
      originalName: normalizeName(session.name),
      storedName,
      mimeType: session.mimeType,
      ext,
      group,
      groupLabel: fileCategoryLabel(group),
      size: session.size,
      uploadedAt: nowIso(),
      updatedAt: nowIso(),
      deviceName: session.deviceName,
      source: session.source,
      note: session.note || "",
      tags: session.tags || [],
      favorite: false,
      deletedAt: null,
      previewable: true,
    };

    state.files.unshift(fileRecord);
    delete uploadSessions.sessions[id];
    persistState();
    persistUploads();
    purgeTempDir(session.sessionDir);

    sendJson(res, 200, { ok: true, file: serializeFile(fileRecord) });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const handled = await handleApi(req, res, url);
    if (handled) return;
    if (req.method === "GET" && serveStatic(req, res, url.pathname)) return;
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      serveStatic(req, res, "/index.html");
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: "Internal server error" });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Vault running at http://${HOST}:${PORT}`);
});
