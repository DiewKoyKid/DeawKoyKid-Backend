const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const {
  createBooking,
  updateBookingStatus,
  cancelBooking,
  completeBooking,
  getMyBookings,
} = require("../controllers/booking.controller");

const router = express.Router();

router.get("/me", authenticateToken, getMyBookings);
router.post("/", authenticateToken, createBooking);
router.patch("/:id/status", authenticateToken, updateBookingStatus);
router.patch("/:id/cancel", authenticateToken, cancelBooking);
router.patch("/:id/complete", authenticateToken, completeBooking);

module.exports = router;
