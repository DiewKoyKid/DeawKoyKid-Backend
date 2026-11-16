const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const { authenticateToken } = require("../middlewares/auth.middleware");

router.post("/register", authController.register);
router.post("/register/provider", authController.registerProvider);
router.post("/login", authController.login);
router.post("/logout", authController.logout);
router.get("/socket-token", authenticateToken, authController.socketToken);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);

module.exports = router;
