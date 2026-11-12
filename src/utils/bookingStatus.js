
const BookingStatus = Object.freeze({
  WAITING_FOR_CONFIRMATION: "WAITING_FOR_CONFIRMATION",
  CONFIRMED: "CONFIRMED",
  // A confirmed booking whose start time has passed (US6-5). The booking
  // progress job moves CONFIRMED bookings here; the customer then completes it.
  IN_PROGRESS: "IN_PROGRESS",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
});

const SLOT_HOLDING_STATUSES = [
  BookingStatus.WAITING_FOR_CONFIRMATION,
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
];

// Bookings still in progress: while a user has one, as the customer or as the
// provider of the booked service, they can't delete their account (US2-3).
const ACTIVE_BOOKING_STATUSES = [
  BookingStatus.WAITING_FOR_CONFIRMATION,
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
];

// A booking the provider accepted and that hasn't been completed or cancelled:
// what the customer can mark complete once it ends (US6-5).
const COMPLETABLE_STATUSES = [
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
];

const BOOKING_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

function isUnansweredBookingExpired(booking, now = Date.now()) {
  return booking.bookingStatus === BookingStatus.WAITING_FOR_CONFIRMATION &&
    booking.createdAt.getTime() + BOOKING_RESPONSE_WINDOW_MS <= now;
}

// When the booked time begins, in the server's timezone (the same one used for
// "today" when booking). A booking without a slot starts at midnight that day.
function bookingStartsAt({ appointmentDate, startTime }) {
  const [hours, minutes] = (startTime || "00:00").split(":").map(Number);
  return new Date(
    appointmentDate.getUTCFullYear(), appointmentDate.getUTCMonth(), appointmentDate.getUTCDate(),
    hours, minutes,
  );
}

function hasBookingStarted(booking, now = Date.now()) {
  return bookingStartsAt(booking).getTime() <= now;
}

// When the booked time ends, in the same timezone as bookingStartsAt. A booking
// without a slot (a whole-day booking) ends at midnight the next day.
function bookingEndsAt({ appointmentDate, startTime, endTime }) {
  const y = appointmentDate.getUTCFullYear();
  const m = appointmentDate.getUTCMonth();
  const d = appointmentDate.getUTCDate();
  if (!startTime || !endTime) return new Date(y, m, d + 1);
  const [hours, minutes] = endTime.split(":").map(Number);
  return new Date(y, m, d, hours, minutes);
}

function hasBookingEnded(booking, now = Date.now()) {
  return bookingEndsAt(booking).getTime() <= now;
}

// The customer can confirm a trip is complete once it has ended (US6-5)
function canCompleteBooking(booking, now = Date.now()) {
  return COMPLETABLE_STATUSES.includes(booking.bookingStatus) && hasBookingEnded(booking, now);
}

module.exports = {
  BookingStatus,
  SLOT_HOLDING_STATUSES,
  ACTIVE_BOOKING_STATUSES,
  COMPLETABLE_STATUSES,
  BOOKING_RESPONSE_WINDOW_MS,
  isUnansweredBookingExpired,
  bookingStartsAt,
  hasBookingStarted,
  bookingEndsAt,
  hasBookingEnded,
  canCompleteBooking,
};
