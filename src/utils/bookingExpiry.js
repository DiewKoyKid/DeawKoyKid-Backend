const { BookingStatus } = require("./bookingStatus");

// How long a provider has to answer a booking request before it expires (F48)
const BOOKING_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

function isUnansweredBookingExpired(booking, now = Date.now()) {
  return booking.bookingStatus === BookingStatus.WAITING_FOR_CONFIRMATION &&
    booking.createdAt.getTime() + BOOKING_RESPONSE_WINDOW_MS <= now;
}

module.exports = {
  BOOKING_RESPONSE_WINDOW_MS,
  isUnansweredBookingExpired,
};
