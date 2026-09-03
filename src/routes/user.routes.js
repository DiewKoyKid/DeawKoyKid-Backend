const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");
const { authenticateToken } = require("../middlewares/auth.middleware");

router.get("/me", authenticateToken, userController.getMyProfile);
router.put("/me", authenticateToken, userController.updateProfile);

// Public — no authenticateToken. Anyone can browse a profile before booking.
router.get("/:id", userController.getPublicProfile);

module.exports = router;
