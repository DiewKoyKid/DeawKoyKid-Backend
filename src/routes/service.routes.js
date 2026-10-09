const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { createService } = require("../controllers/service.controller");

const router = express.Router();

router.post("/", authenticateToken, createService);

module.exports = router;
