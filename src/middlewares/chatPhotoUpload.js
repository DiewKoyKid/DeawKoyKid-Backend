const multer = require("multer");

const MAX_CHAT_PHOTO_BYTES = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHAT_PHOTO_BYTES, files: 1, fields: 1, fieldSize: 8000 },
  fileFilter(req, file, cb) {
    if (["image/jpeg", "image/png"].includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error("Photo must be a JPG or PNG image."), { status: 400 }));
  },
}).single("image");

function chatPhotoUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    const error = err.code === "LIMIT_FILE_SIZE"
      ? "Photo must be 5 MB or smaller."
      : err instanceof multer.MulterError
        ? "Send one JPG or PNG in the image field, with an optional caption."
        : err.message;
    res.status(err instanceof multer.MulterError ? 400 : err.status || 500).json({ error });
  });
}

function hasImageSignature(file) {
  const bytes = file.buffer;
  if (file.mimetype === "image/png") {
    return bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.toString("ascii", 12, 16) === "IHDR";
  }
  return file.mimetype === "image/jpeg" && bytes.length >= 4
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

module.exports = { chatPhotoUpload, hasImageSignature, MAX_CHAT_PHOTO_BYTES };
