const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const {
  createBooking,
  updateBookingStatus,
  cancelBooking,
  completeBooking,
  getMyBookings,
} = require("../controllers/booking.controller");
const { getBookingMessages, requireChatWrite, sendChatPhoto, getChatPhoto } = require("../controllers/chat.controller");
const { chatPhotoUpload } = require("../middlewares/chatPhotoUpload");

const router = express.Router();

router.get("/me", authenticateToken, getMyBookings);
router.post("/", authenticateToken, createBooking);
router.patch("/:id/status", authenticateToken, updateBookingStatus);
router.patch("/:id/cancel", authenticateToken, cancelBooking);
router.patch("/:id/complete", authenticateToken, completeBooking);
router.get("/:id/messages", authenticateToken, getBookingMessages);
router.post("/:id/messages/image", authenticateToken, requireChatWrite, chatPhotoUpload, sendChatPhoto);
router.get("/:id/messages/:messageId/image", authenticateToken, getChatPhoto);

module.exports = router;
