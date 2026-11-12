const { getChatAccess, listMessages, createMessage } = require("../services/chat.service");
const prisma = require("../lib/prisma");
const { hasImageSignature } = require("../middlewares/chatPhotoUpload");

async function requireChatWrite(req, res, next) {
  try {
    await getChatAccess(req.params.id, req.user.userId, { write: true });
    next();
  } catch (err) { next(err); }
}

// Multipart upload also creates the message, so there are no unused attachments.
async function sendChatPhoto(req, res, next) {
  try {
    if (!req.file || !hasImageSignature(req.file)) {
      return res.status(400).json({ error: "Photo must be a JPG or PNG image." });
    }
    // Recheck after receiving the upload in case the booking changed meanwhile.
    await getChatAccess(req.params.id, req.user.userId, { write: true });
    const message = await createMessage(req.params.id, req.user.userId, req.body.content, req.file);
    req.app.get("chatIo")?.to(`booking:${req.params.id}`).emit("chat:message", message);
    res.status(201).json({ message });
  } catch (err) { next(err); }
}

async function getChatPhoto(req, res, next) {
  try {
    await getChatAccess(req.params.id, req.user.userId);
    const message = await prisma.chatLog.findFirst({
      where: { id: req.params.messageId, bookingId: req.params.id },
      select: { imageData: true, imageMimeType: true },
    });
    if (!message?.imageData) return res.status(404).json({ error: "Photo not found." });
    res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    res.type(message.imageMimeType).send(Buffer.from(message.imageData));
  } catch (err) { next(err); }
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
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

module.exports = { getBookingMessages, requireChatWrite, sendChatPhoto, getChatPhoto };
