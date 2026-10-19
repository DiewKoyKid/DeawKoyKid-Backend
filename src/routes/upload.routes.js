const express = require("express");
const router = express.Router();
const upload = require("../middlewares/upload");
const { authenticateToken } = require("../middlewares/auth.middleware");

// POST /api/upload
// Expects a form-data field named "image"
router.post("/", authenticateToken, upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided." });
    }

    // The public URL to access this image.
    // In local development, the backend serves the /public folder statically.
    const imageUrl = `/uploads/${req.file.filename}`;
    
    return res.status(200).json({ url: imageUrl });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: "Failed to upload image." });
  }
});

module.exports = router;

