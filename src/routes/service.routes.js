const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { createService, getServiceById } = require("../controllers/service.controller");

const router = express.Router();

router.post("/", authenticateToken, createService);
router.get("/:id", getServiceById);

module.exports = router;
