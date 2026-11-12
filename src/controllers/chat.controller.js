const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { getChatAccess, listMessages, createMessage } = require("../services/chat.service");
const { detectType, TYPE_ERROR } = require("../middlewares/chatPhotoUpload");
const { broadcastMessage } = require("../socket/chat.socket");

const CHAT_PHOTO_DIR = path.join(__dirname, "../../public/uploads/chat-photos");

function sendKnownError(err, res, next) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  next(err);
}

// GET /api/bookings/:id/messages — chat history, oldest first (US7-1)
async function getBookingMessages(req, res, next) {
  try {
    const { booking, role } = await getChatAccess(req.params.id, req.user.userId);
    const messages = await listMessages(booking.id);
    const other =
      role === "customer" ? booking.service.provider?.user : booking.customer?.user;
    res.json({
      booking: {
        id: booking.id,
        status: booking.bookingStatus,
        serviceTitle: booking.service.title,
        appointmentDate: booking.appointmentDate?.toISOString().slice(0, 10) ?? null,
        startTime: booking.startTime ?? null,
        endTime: booking.endTime ?? null,
        canSend: booking.bookingStatus === "CONFIRMED",
      },
      role,
      otherParty: other
        ? {
            id: other.id,
            firstname: other.firstname,
            lastname: other.lastname,
            profilePhotoUrl: other.profilePhotoUrl ?? null,
          }
        : null,
      messages,
    });
  } catch (err) {
    sendKnownError(err, res, next);
  }
}

// Runs before the upload is read, so outsiders are refused without buffering a file.
async function requireChatWrite(req, res, next) {
  try {
    await getChatAccess(req.params.id, req.user.userId, { write: true });
    next();
  } catch (err) {
    sendKnownError(err, res, next);
  }
}

// POST /api/bookings/:id/messages/photo — multipart "photo" (JPG/PNG, max 5 MB)
// and an optional "content" caption (US7-2). The message is also pushed live.
async function sendChatPhoto(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: "Choose a photo to send" });
    const type = detectType(req.file.buffer);
    if (!type) return res.status(415).json({ error: TYPE_ERROR });

    const filename = `${crypto.randomUUID()}${type.ext}`;
    await fs.mkdir(CHAT_PHOTO_DIR, { recursive: true });
    await fs.writeFile(path.join(CHAT_PHOTO_DIR, filename), req.file.buffer);

    const caption = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    const message = await createMessage(req.params.id, req.user.userId, caption, {
      imageUrl: `/uploads/chat-photos/${filename}`,
    });
    broadcastMessage(message);
    res.status(201).json({ message });
  } catch (err) {
    sendKnownError(err, res, next);
  }
}

module.exports = { getBookingMessages, requireChatWrite, sendChatPhoto };
