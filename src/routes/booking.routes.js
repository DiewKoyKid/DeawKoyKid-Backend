const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { createBooking, updateBookingStatus, cancelBooking } = require("../controllers/booking.controller");

const router = express.Router();

router.post("/", authenticateToken, createBooking);
router.patch("/:id/status", authenticateToken, updateBookingStatus);
router.patch("/:id/cancel", authenticateToken, cancelBooking);

module.exports = router;
