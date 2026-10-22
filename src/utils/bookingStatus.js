
const BookingStatus = Object.freeze({
  WAITING_FOR_CONFIRMATION: "WAITING_FOR_CONFIRMATION",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
});

const SLOT_HOLDING_STATUSES = [
  BookingStatus.WAITING_FOR_CONFIRMATION,
  BookingStatus.CONFIRMED,
];

// Bookings still in progress: while a user has one, as the customer or as the
// provider of the booked service, they can't delete their account (US2-3).
// IN_PROGRESS belongs in this list once Tong's US6-5 adds it.
const ACTIVE_BOOKING_STATUSES = [
  BookingStatus.WAITING_FOR_CONFIRMATION,
  BookingStatus.CONFIRMED,
];

const BOOKING_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

function isUnansweredBookingExpired(booking, now = Date.now()) {
  return booking.bookingStatus === BookingStatus.WAITING_FOR_CONFIRMATION &&
    booking.createdAt.getTime() + BOOKING_RESPONSE_WINDOW_MS <= now;
}

module.exports = {
  BookingStatus,
  SLOT_HOLDING_STATUSES,
  ACTIVE_BOOKING_STATUSES,
  BOOKING_RESPONSE_WINDOW_MS,
  isUnansweredBookingExpired,
};
