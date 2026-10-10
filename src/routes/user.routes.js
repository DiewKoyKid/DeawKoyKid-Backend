const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { profilePhotoUpload } = require("../middlewares/profilePhotoUpload");

router.get("/me", authenticateToken, userController.getMyProfile);
router.put("/me", authenticateToken, userController.updateProfile);
router.post("/me/provider", authenticateToken, userController.addProviderProfile);
router.put("/me/photo", authenticateToken, profilePhotoUpload, userController.uploadMyPhoto);
router.delete("/me/photo", authenticateToken, userController.deleteMyPhoto);

// Public — no authenticateToken. Anyone can browse a profile before booking.
router.get("/:id", userController.getPublicProfile);

module.exports = router;
