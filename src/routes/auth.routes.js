const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");

router.post("/register", authController.register);
// router.post("/register/provider", authController.registerProvider); // blocked: Provider model needs a `status` field first
router.post("/login", authController.login);

module.exports = router;
