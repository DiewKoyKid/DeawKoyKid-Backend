const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { createBooking } = require("../controllers/booking.controller");

const router = express.Router();

router.post("/", authenticateToken, createBooking);

module.exports = router;
