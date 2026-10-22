const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { createReview } = require("../controllers/review.controller");

const router = express.Router();

router.post("/", authenticateToken, createReview);

module.exports = router;
