const multer = require("multer");
const path = require("path");
const { randomUUID } = require("crypto");
const {
  MAX_BYTES, MAX_FILES, FILE_TYPES, badRequest, prepareDirectory, cleanupAttachments,
} = require("../utils/complaintAttachments");

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, req.complaintDirectory),
    filename: (req, file, cb) => cb(null, `${randomUUID()}${FILE_TYPES[file.mimetype].extensions[0]}`),
  }),
  // Parsers may emit LIMIT_FILE_SIZE upon reaching the limit. Allow one sentinel
  // byte here and enforce <= MAX_BYTES after upload, so exactly 10 MiB is valid.
  limits: { fileSize: MAX_BYTES + 1, files: MAX_FILES, fields: 4, fieldSize: 16 * 1024, parts: 10 },
  fileFilter: (req, file, cb) => {
    const type = FILE_TYPES[file.mimetype];
    const name = path.win32.basename(file.originalname);
    if (!name || [...name].length > 255 || /[\x00-\x1f\x7f]/.test(name)) {
      return cb(badRequest("attachment filename must be 1 to 255 characters without control characters"));
    }
    if (!type || !type.extensions.includes(path.extname(name).toLowerCase())) {
      return cb(badRequest("attachments must be JPG, PNG or PDF with a matching MIME type"));
    }
    file.originalname = name;
    cb(null, true);
  },
}).array("attachments", MAX_FILES);

async function complaintUpload(req, res, next) {
  if (!req.is("multipart/form-data")) {
    return res.status(415).json({ error: "Content-Type must be multipart/form-data" });
  }
  try {
    await prepareDirectory(req);
  } catch (err) {
    console.error("Complaint storage error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
  upload(req, res, async (err) => {
    if (!err) return next();
    try {
      await cleanupAttachments(req);
    } catch (cleanupError) {
      console.error("Complaint cleanup error:", cleanupError);
    }
    if (err instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: "each attachment must be 10 MiB or smaller",
        LIMIT_FILE_COUNT: "at most 5 attachments are allowed",
        LIMIT_UNEXPECTED_FILE: 'send at most 5 files in the "attachments" field',
        LIMIT_FIELD_COUNT: "only bookingId, category, subject and description are allowed",
        LIMIT_FIELD_VALUE: "field value is too long",
        LIMIT_PART_COUNT: "too many multipart parts",
      };
      return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400)
        .json({ error: messages[err.code] || "Invalid multipart form" });
    }
    if (err.status === 400 || /Multipart|Unexpected end of form|Unexpected end of file/i.test(err.message)) {
      return res.status(400).json({ error: err.status === 400 ? err.message : "Invalid multipart form" });
    }
    console.error("Complaint upload error:", err);
    return res.status(500).json({ error: "Internal server error" });
  });
}

module.exports = { complaintUpload };
