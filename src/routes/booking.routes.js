const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const {
  createBooking,
  updateBookingStatus,
  cancelBooking,
  getMyBookings,
} = require("../controllers/booking.controller");

const router = express.Router();

router.get("/me", authenticateToken, getMyBookings);
router.post("/", authenticateToken, createBooking);
router.patch("/:id/status", authenticateToken, updateBookingStatus);
router.patch("/:id/cancel", authenticateToken, cancelBooking);

module.exports = router;
