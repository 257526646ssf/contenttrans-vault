const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { Readable } = require("stream");
const { S3Client, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

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
const MAX_TEXT_NOTE_CHARS = 200000;
const STORAGE_DRIVER = String(process.env.STORAGE_DRIVER || "local").trim().toLowerCase();
const S3_REGION = String(process.env.S3_REGION || "").trim();
const S3_ENDPOINT = String(process.env.S3_ENDPOINT || "").trim();
const S3_BUCKET = String(process.env.S3_BUCKET || "").trim();
const S3_ACCESS_KEY_ID = String(process.env.S3_ACCESS_KEY_ID || "").trim();
const S3_SECRET_ACCESS_KEY = String(process.env.S3_SECRET_ACCESS_KEY || "").trim();
const S3_PUBLIC_BASE_URL = String(process.env.S3_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
const S3_FORCE_PATH_STYLE = String(process.env.S3_FORCE_PATH_STYLE || "").trim().toLowerCase() === "true";

ensureDirSync(DATA_DIR);
ensureDirSync(STORAGE_DIR);
ensureDirSync(FILE_DIR);
ensureDirSync(TEMP_DIR);

const storage = createStorage();

const state = loadJson(STATE_FILE, {
  version: 1,
  files: [],
  layout: {
    updatedAt: null,
    offsets: {},
  },
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

function createStorage() {
  if (STORAGE_DRIVER === "local") {
    return {
      mode: "local",
      publicBaseUrl: "",
      async hasContent(file) {
        return fs.existsSync(path.join(FILE_DIR, file.storedName));
      },
      async putObject(storedName, sourcePath, contentType) {
        const finalPath = path.join(FILE_DIR, storedName);
        fs.copyFileSync(sourcePath, finalPath);
        return {
          storedName,
          objectKey: storedName,
          storageDriver: "local",
          storagePath: finalPath,
          publicUrl: "",
          mimeType: contentType || "application/octet-stream",
        };
      },
      async createReadStream(file) {
        return fs.createReadStream(path.join(FILE_DIR, file.storedName));
      },
      async deleteObject(file) {
        const fullPath = path.join(FILE_DIR, file.storedName);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      },
    };
  }

  if (STORAGE_DRIVER === "s3") {
    const missing = [];
    if (!S3_REGION) missing.push("S3_REGION");
    if (!S3_ENDPOINT) missing.push("S3_ENDPOINT");
    if (!S3_BUCKET) missing.push("S3_BUCKET");
    if (!S3_ACCESS_KEY_ID) missing.push("S3_ACCESS_KEY_ID");
    if (!S3_SECRET_ACCESS_KEY) missing.push("S3_SECRET_ACCESS_KEY");
    if (missing.length) {
      throw new Error(`Missing S3 configuration: ${missing.join(", ")}`);
    }

    const client = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      forcePathStyle: S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
      },
    });

    return {
      mode: "s3",
      publicBaseUrl: S3_PUBLIC_BASE_URL,
      async hasContent(file) {
        try {
          await client.send(
            new HeadObjectCommand({
              Bucket: S3_BUCKET,
              Key: file.objectKey || file.storedName,
            })
          );
          return true;
        } catch (error) {
          if (String(error?.name || "").includes("NotFound") || error?.$metadata?.httpStatusCode === 404) {
            return false;
          }
          throw error;
        }
      },
      async putObject(storedName, sourcePath, contentType) {
        const objectKey = storedName;
        await client.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: objectKey,
            Body: fs.createReadStream(sourcePath),
            ContentType: contentType || "application/octet-stream",
          })
        );
        return {
          storedName,
          objectKey,
          storageDriver: "s3",
          storagePath: `s3://${S3_BUCKET}/${objectKey}`,
          publicUrl: S3_PUBLIC_BASE_URL ? `${S3_PUBLIC_BASE_URL}/${encodeURIComponent(objectKey).replace(/%2F/g, "/")}` : "",
          mimeType: contentType || "application/octet-stream",
        };
      },
      async createReadStream(file) {
        const response = await client.send(
          new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: file.objectKey || file.storedName,
          })
        );
        return toNodeReadable(response.Body);
      },
      async deleteObject(file) {
        await client.send(
          new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: file.objectKey || file.storedName,
          })
        );
      },
    };
  }

  throw new Error(`Unsupported STORAGE_DRIVER: ${STORAGE_DRIVER}`);
}

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
    storageDriver: file.storageDriver || storage.mode,
    publicUrl: file.publicUrl || "",
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

function sanitizeLayoutOffsets(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const entries = Object.entries(input).slice(0, 64);
  const offsets = {};

  for (const [panelId, value] of entries) {
    if (!/^[a-z0-9-]{1,64}$/i.test(panelId)) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    const x = Number(value.x);
    const y = Number(value.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    offsets[panelId] = {
      x: Math.round(x),
      y: Math.round(y),
    };
  }

  return offsets;
}

function getLayoutState() {
  if (!state.layout || typeof state.layout !== "object") {
    state.layout = { updatedAt: null, offsets: {} };
  }
  if (!state.layout.offsets || typeof state.layout.offsets !== "object") {
    state.layout.offsets = {};
  }
  return state.layout;
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

function finalUploadTempPath(session) {
  return path.join(session.sessionDir, "__complete__.upload");
}

function purgeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFileBuffer(filePath, buffer) {
  fs.writeFileSync(filePath, buffer);
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function getTextNoteContent(file) {
  if (typeof file.textContent === "string") return file.textContent;

  try {
    const stream = await storage.createReadStream(file);
    return (await streamToBuffer(stream)).toString("utf8");
  } catch (error) {
    return "";
  }
}

function textNoteName(text, name) {
  const firstLine = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const base = normalizeName(String(name || firstLine || "文本记录").slice(0, 80));
  return base.toLowerCase().endsWith(".txt") ? base : `${base}.txt`;
}

function toNodeReadable(body) {
  if (!body) throw new Error("Empty object body");
  if (typeof body.pipe === "function") return body;
  if (body instanceof Readable) return body;
  if (typeof body.transformToWebStream === "function") return Readable.fromWeb(body.transformToWebStream());
  if (typeof body.getReader === "function") return Readable.fromWeb(body);
  throw new Error("Unsupported stream body");
}

async function objectExists(file) {
  return storage.hasContent(file);
}

async function sendStoredFile(res, file, disposition) {
  const stream = await storage.createReadStream(file);
  res.writeHead(200, {
    "Content-Type": file.mimeType || "application/octet-stream",
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
  });
  stream.pipe(res);
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, time: nowIso(), stats: getStats(), storage: storage.mode });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/layout") {
    const layout = getLayoutState();
    sendJson(res, 200, {
      layout: {
        updatedAt: layout.updatedAt || null,
        offsets: layout.offsets || {},
      },
    });
    return true;
  }

  if (req.method === "PUT" && pathname === "/api/layout") {
    const body = await readJsonBody(req);
    const layout = getLayoutState();
    layout.offsets = sanitizeLayoutOffsets(body.offsets);
    layout.updatedAt = nowIso();
    persistState();
    sendJson(res, 200, {
      ok: true,
      layout: {
        updatedAt: layout.updatedAt,
        offsets: layout.offsets,
      },
    });
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

    const exists = await objectExists(file);
    if (!exists) {
      sendJson(res, 404, { error: "File content missing" });
      return true;
    }

    if (action === "download") {
      await sendStoredFile(res, file, "attachment");
      return true;
    }

    if (action === "preview") {
      await sendStoredFile(res, file, "inline");
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
      await storage.deleteObject(file);
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

  if (req.method === "GET" && pathname === "/api/text-notes") {
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
    const records = state.files
      .filter((file) => file.source === "text-note" && !file.deletedAt)
      .sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime())
      .slice(-limit);

    const messages = [];
    for (const file of records) {
      messages.push({
        id: file.id,
        text: await getTextNoteContent(file),
        createdAt: file.uploadedAt,
        updatedAt: file.updatedAt,
        deviceName: file.deviceName || "未命名设备",
        size: file.size || 0,
        originalName: file.originalName,
      });
    }

    sendJson(res, 200, { messages });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/text-notes") {
    const body = await readJsonBody(req);
    const text = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n").trimEnd() : "";

    if (!text.trim()) {
      sendJson(res, 400, { error: "Text is required" });
      return true;
    }

    if (text.length > MAX_TEXT_NOTE_CHARS) {
      sendJson(res, 413, { error: `Text exceeds ${MAX_TEXT_NOTE_CHARS} characters` });
      return true;
    }

    const fileId = safeId();
    const originalName = textNoteName(text, body.name);
    const storedName = `${fileId}.txt`;
    const tempPath = path.join(TEMP_DIR, storedName);

    try {
      fs.writeFileSync(tempPath, text, "utf8");
      const stored = await storage.putObject(storedName, tempPath, "text/plain; charset=utf-8");
      const fileRecord = {
        id: fileId,
        originalName,
        storedName: stored.storedName,
        objectKey: stored.objectKey,
        storageDriver: stored.storageDriver,
        storagePath: stored.storagePath,
        publicUrl: stored.publicUrl,
        mimeType: "text/plain; charset=utf-8",
        ext: ".txt",
        group: "text",
        groupLabel: fileCategoryLabel("text"),
        size: Buffer.byteLength(text, "utf8"),
        uploadedAt: nowIso(),
        updatedAt: nowIso(),
        deviceName: String(body.deviceName || "未命名设备").slice(0, 120),
        source: "text-note",
        note: typeof body.note === "string" ? body.note.slice(0, 5000) : "文本快存",
        tags: parseTags(body.tags).slice(0, 30),
        textContent: text,
        favorite: false,
        deletedAt: null,
        previewable: true,
      };

      state.files.unshift(fileRecord);
      persistState();
      sendJson(res, 200, { ok: true, file: serializeFile(fileRecord) });
      return true;
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
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
    const assembledPath = finalUploadTempPath(session);
    const fd = fs.openSync(assembledPath, "w");
    for (let i = 0; i < session.totalChunks; i += 1) {
      const buffer = fs.readFileSync(chunkPath(session, i));
      fs.writeSync(fd, buffer);
    }
    fs.closeSync(fd);
    const stored = await storage.putObject(storedName, assembledPath, session.mimeType);

    const group = extToGroup(ext, session.mimeType);
    const fileRecord = {
      id: fileId,
      originalName: normalizeName(session.name),
      storedName: stored.storedName,
      objectKey: stored.objectKey,
      storageDriver: stored.storageDriver,
      storagePath: stored.storagePath,
      publicUrl: stored.publicUrl,
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
