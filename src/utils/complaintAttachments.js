const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const STORAGE_ROOT = process.env.COMPLAINT_STORAGE_DIR
  ? path.resolve(process.env.COMPLAINT_STORAGE_DIR)
  : path.resolve(__dirname, "../../storage/complaints");
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;
const FILE_TYPES = {
  "image/jpeg": { extensions: [".jpg", ".jpeg"], signature: Buffer.from([0xff, 0xd8, 0xff]) },
  "image/png": { extensions: [".png"], signature: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) },
  "application/pdf": { extensions: [".pdf"], signature: Buffer.from("%PDF-") },
};

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

async function validateAttachment(file) {
  if (file.size <= 0) throw badRequest("attachments must not be empty");
  if (file.size > MAX_BYTES) throw Object.assign(new Error("each attachment must be 10 MiB or smaller"), { status: 413 });
  const type = FILE_TYPES[file.mimetype];
  const handle = await fs.open(file.path, "r");
  try {
    const bytes = Buffer.alloc(type.signature.length);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length || !bytes.equals(type.signature)) {
      throw badRequest("attachment content does not match its file type");
    }
  } finally {
    await handle.close();
  }
}

async function prepareDirectory(req) {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
  req.complaintDirectory = await fs.mkdtemp(path.join(STORAGE_ROOT, ".tmp-"));
}

async function persistAttachments(req) {
  if (!req.files?.length) return [];
  const folder = randomUUID();
  const destination = path.join(STORAGE_ROOT, folder);
  await fs.rename(req.complaintDirectory, destination);
  req.complaintDirectory = destination;
  return req.files.map((file) => ({
    originalName: file.originalname,
    storageKey: `${folder}/${file.filename}`,
    mimeType: file.mimetype,
    sizeBytes: file.size,
  }));
}

async function cleanupAttachments(req) {
  if (!req.complaintDirectory) return;
  // Only remove this request's server-generated direct child of private storage.
  const directory = path.resolve(req.complaintDirectory);
  if (path.dirname(directory) !== STORAGE_ROOT) throw new Error("Invalid complaint storage directory");
  await fs.rm(directory, { recursive: true, force: true });
  req.complaintDirectory = undefined;
}

module.exports = {
  STORAGE_ROOT, MAX_BYTES, MAX_FILES, FILE_TYPES, badRequest,
  validateAttachment, prepareDirectory, persistAttachments, cleanupAttachments,
};
