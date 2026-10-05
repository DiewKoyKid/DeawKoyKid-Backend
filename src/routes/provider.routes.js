const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { getMyServices } = require("../controllers/provider.controller");

const router = express.Router();

router.get("/me/services", authenticateToken, getMyServices);

module.exports = router;