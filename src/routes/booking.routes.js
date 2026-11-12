const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const {
  createBooking,
  updateBookingStatus,
  cancelBooking,
  getMyBookings,
} = require("../controllers/booking.controller");
const {
  getBookingMessages,
  requireChatWrite,
  sendChatPhoto,
} = require("../controllers/chat.controller");
const { chatPhotoUpload } = require("../middlewares/chatPhotoUpload");

const router = express.Router();

router.get("/me", authenticateToken, getMyBookings);
router.post("/", authenticateToken, createBooking);
router.patch("/:id/status", authenticateToken, updateBookingStatus);
router.patch("/:id/cancel", authenticateToken, cancelBooking);
router.get("/:id/messages", authenticateToken, getBookingMessages);
router.post(
  "/:id/messages/photo",
  authenticateToken,
  requireChatWrite,
  chatPhotoUpload,
  sendChatPhoto
);

module.exports = router;
