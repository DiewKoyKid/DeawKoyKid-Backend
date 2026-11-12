// Chat photos (US7-2): JPG or PNG only, at most 5 MB. Kept in memory first so
// the file's real bytes can be checked, not just the type the browser claims.
const multer = require("multer");

const MAX_CHAT_PHOTO_BYTES = 5 * 1024 * 1024;
const TYPES = {
  "image/jpeg": { ext: ".jpg", magic: [0xff, 0xd8, 0xff] },
  "image/png": { ext: ".png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
};
const TYPE_ERROR = "Only JPG or PNG photos can be sent";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHAT_PHOTO_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (TYPES[file.mimetype]) return cb(null, true);
    const err = new Error(TYPE_ERROR);
    err.status = 415;
    cb(err);
  },
}).single("photo");

// Detects the type from the first bytes; null when it isn't a JPG or PNG.
function detectType(buffer) {
  for (const [mime, { ext, magic }] of Object.entries(TYPES)) {
    if (buffer.length >= magic.length && magic.every((b, i) => buffer[i] === b)) {
      return { mime, ext };
    }
  }
  return null;
}

// Runs multer and turns its errors into the API's { error } responses.
function chatPhotoUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Photo must be 5 MB or smaller" });
    }
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
    next(err);
  });
}

module.exports = { chatPhotoUpload, detectType, MAX_CHAT_PHOTO_BYTES, TYPE_ERROR };
