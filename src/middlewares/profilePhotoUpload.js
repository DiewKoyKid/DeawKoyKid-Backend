const fs = require("fs");
const path = require("path");
const multer = require("multer");

// Profile photos get their own folder under the static /uploads route
// (see app.js), apart from service cover photos.
const PROFILE_PHOTO_DIR = path.join(__dirname, "../../public/uploads/profile-photos");
const PROFILE_PHOTO_URL_PREFIX = "/uploads/profile-photos/";
const MAX_BYTES = 5 * 1024 * 1024;
const EXTENSION_BY_TYPE = { "image/jpeg": ".jpg", "image/png": ".png" };

fs.mkdirSync(PROFILE_PHOTO_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: PROFILE_PHOTO_DIR,
    filename: (req, file, cb) => {
      const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${req.user.userId}-${suffix}${EXTENSION_BY_TYPE[file.mimetype]}`);
    },
  }),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (EXTENSION_BY_TYPE[file.mimetype]) return cb(null, true);
    const err = new Error("photo must be a JPG or PNG image");
    err.status = 400;
    return cb(err);
  },
});

// Accepts one image in the form field "photo" and turns multer's errors into
// 400s with a readable message instead of the generic 500.
function profilePhotoUpload(req, res, next) {
  upload.single("photo")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const error =
        err.code === "LIMIT_FILE_SIZE"
          ? "photo must be 5 MB or smaller"
          : err.code === "LIMIT_UNEXPECTED_FILE"
            ? 'send one image in the form field "photo"'
            : err.message;
      return res.status(400).json({ error });
    }
    return res.status(err.status || 500).json({ error: err.message });
  });
}

module.exports = { profilePhotoUpload, PROFILE_PHOTO_DIR, PROFILE_PHOTO_URL_PREFIX };
