const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { normalizeText, safeFileName } = require("./roundtable-utils");

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "application/json": ".json",
  "text/csv": ".csv",
};

function uploadsRoot(stateDir) {
  return path.resolve(stateDir, "uploads");
}

function normalizeMimeType(value) {
  return normalizeText(value).toLowerCase() || "application/octet-stream";
}

function todayPathParts(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return [`${year}-${month}-${day}`];
}

function saveBase64Attachment({ stateDir, data, mimeType, name = "" }) {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const buffer = Buffer.from(normalizeText(data), "base64");
  if (!buffer.length) {
    throw new Error("upload data is empty");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`upload exceeds ${MAX_UPLOAD_BYTES} bytes`);
  }

  const dateParts = todayPathParts();
  const dir = path.join(uploadsRoot(stateDir), ...dateParts);
  fs.mkdirSync(dir, { recursive: true });

  const ext = path.extname(normalizeText(name))
    || MIME_TO_EXT[normalizedMimeType]
    || ".bin";
  const baseName = safeFileName(path.basename(normalizeText(name), path.extname(normalizeText(name))))
    || "upload";
  const filename = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${baseName}${ext}`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, buffer);

  const relativeUrlPath = [...dateParts, filename].join("/");
  return {
    name: normalizeText(name) || filename,
    url: `/uploads/${relativeUrlPath}`,
    mimeType: normalizedMimeType,
    size: buffer.length,
  };
}

function resolveUploadPath(stateDir, url) {
  const normalizedUrl = normalizeText(url);
  if (!normalizedUrl.startsWith("/uploads/")) {
    return "";
  }
  const root = uploadsRoot(stateDir);
  const candidate = path.resolve(root, normalizedUrl.slice("/uploads/".length));
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    return "";
  }
  return candidate;
}

function contentTypeForAttachment(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".csv":
      return "text/csv; charset=utf-8";
    case ".mp3":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}

module.exports = {
  MAX_UPLOAD_BYTES,
  contentTypeForAttachment,
  resolveUploadPath,
  saveBase64Attachment,
};
