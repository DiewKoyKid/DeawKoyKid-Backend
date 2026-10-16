const { BookingStatus } = require("../utils/bookingStatus");

const NEW_BOOKING_REQUEST = "NEW_BOOKING_REQUEST";

// Notification type for each status a booking can move into. Moving back to
// WAITING_FOR_CONFIRMATION has no entry, so it notifies no one.
const BOOKING_STATUS_NOTIFICATION_TYPES = Object.freeze({
  [BookingStatus.CONFIRMED]: "BOOKING_CONFIRMED",
  [BookingStatus.REJECTED]: "BOOKING_REJECTED",
  [BookingStatus.EXPIRED]: "BOOKING_EXPIRED",
  [BookingStatus.CANCELLED]: "BOOKING_CANCELLED",
  [BookingStatus.COMPLETED]: "BOOKING_COMPLETED",
});

const STATUS_WORDING = Object.freeze({
  [BookingStatus.CONFIRMED]: "was confirmed",
  [BookingStatus.REJECTED]: "was rejected",
  [BookingStatus.EXPIRED]: "expired without a response",
  [BookingStatus.CANCELLED]: "was cancelled",
  [BookingStatus.COMPLETED]: "was completed",
});

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

// Creates the provider's in-app notification for a new booking request. Pass
// the transaction client so it commits (or rolls back) together with the booking.
// Email delivery and the user's email setting are Max's F53.
function notifyProviderOfNewBooking(tx, { booking, providerId, serviceTitle, customerName }) {
  const date = toDateString(booking.appointmentDate);
  return tx.notification.create({
    data: {
      userId: providerId,
      bookingId: booking.id,
      type: NEW_BOOKING_REQUEST,
      message: `${customerName} requested "${serviceTitle}" on ${date}.`,
    },
  });
}

// F52 status-change hook: tells the customer and the provider that a booking
// moved to its current status, skipping whoever made the change (actorId).
// System changes such as expiry pass no actorId, so both sides hear about it.
// Pass the transaction client that changed the status so both commit together.
// Resolves to the created notifications, e.g. for F53 to email after commit.
async function notifyBookingStatusChange(tx, { booking, providerId, serviceTitle, actorId = null }) {
  const type = BOOKING_STATUS_NOTIFICATION_TYPES[booking.bookingStatus];
  if (!type) return [];

  const what = `for "${serviceTitle}" on ${toDateString(booking.appointmentDate)} ${STATUS_WORDING[booking.bookingStatus]}`;
  const recipients = [
    { userId: booking.customerId, message: `Your booking ${what}.` },
    { userId: providerId, message: `The booking ${what}.` },
  ].filter(({ userId }) => userId !== actorId);
  if (recipients.length === 0) return [];

  return tx.notification.createManyAndReturn({
    data: recipients.map(({ userId, message }) => ({ userId, bookingId: booking.id, type, message })),
  });
}

module.exports = {
  NEW_BOOKING_REQUEST,
  BOOKING_STATUS_NOTIFICATION_TYPES,
  notifyProviderOfNewBooking,
  notifyBookingStatusChange,
};
