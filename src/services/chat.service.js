// Booking chat (US7-1). Only the customer and the provider of a booking can
// use its chat, and only once the provider has confirmed it. History stays
// readable after the trip is completed, but new messages need CONFIRMED.
const prisma = require("../lib/prisma");

const MAX_MESSAGE_LENGTH = 2000;
const READABLE_STATUSES = ["CONFIRMED", "COMPLETED"];
const WRITABLE_STATUSES = ["CONFIRMED"];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const PERSON_SELECT = { id: true, firstname: true, lastname: true, profilePhotoUrl: true };

// Resolves the booking and the caller's side of it, or throws 404 / 403.
async function getChatAccess(bookingId, userId, { write = false } = {}) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      customerId: true,
      bookingStatus: true,
      appointmentDate: true,
      startTime: true,
      endTime: true,
      service: {
        select: {
          providerId: true,
          title: true,
          provider: { select: { user: { select: PERSON_SELECT } } },
        },
      },
      customer: { select: { user: { select: PERSON_SELECT } } },
    },
  });
  if (!booking) throw httpError(404, "booking not found");

  const role =
    booking.customerId === userId
      ? "customer"
      : booking.service.providerId === userId
        ? "provider"
        : null;
  if (!role) throw httpError(403, "you are not part of this booking");

  const allowed = write ? WRITABLE_STATUSES : READABLE_STATUSES;
  if (!allowed.includes(booking.bookingStatus)) {
    throw httpError(403, "chat is only available for confirmed bookings");
  }
  return { booking, role };
}

const MESSAGE_SELECT = {
  id: true,
  bookingId: true,
  senderId: true,
  content: true,
  timestamp: true,
  sender: { select: { firstname: true, lastname: true, profilePhotoUrl: true } },
};

function toMessage(row) {
  return {
    id: row.id,
    bookingId: row.bookingId,
    senderId: row.senderId,
    senderName: [row.sender?.firstname, row.sender?.lastname].filter(Boolean).join(" "),
    senderPhotoUrl: row.sender?.profilePhotoUrl ?? null,
    content: row.content,
    timestamp: row.timestamp.toISOString(),
  };
}

async function listMessages(bookingId) {
  const rows = await prisma.chatLog.findMany({
    where: { bookingId },
    orderBy: { timestamp: "asc" },
    select: MESSAGE_SELECT,
  });
  return rows.map(toMessage);
}

function validateContent(content) {
  if (typeof content !== "string" || !content.trim()) {
    throw httpError(400, "message cannot be empty");
  }
  const text = content.trim();
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw httpError(400, `message must be at most ${MAX_MESSAGE_LENGTH} characters`);
  }
  return text;
}

async function createMessage(bookingId, senderId, content) {
  const text = validateContent(content);
  const row = await prisma.chatLog.create({
    data: { bookingId, senderId, content: text },
    select: MESSAGE_SELECT,
  });
  return toMessage(row);
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  getChatAccess,
  listMessages,
  createMessage,
  validateContent,
};
