const NEW_BOOKING_REQUEST = "NEW_BOOKING_REQUEST";

// Creates the provider's in-app notification for a new booking request. Pass
// the transaction client so it commits (or rolls back) together with the booking.
// Email delivery and the user's email setting are Max's F53; status-change
// notifications for the customer are Den's F52.
function notifyProviderOfNewBooking(tx, { booking, providerId, serviceTitle, customerName }) {
  const date = booking.appointmentDate.toISOString().slice(0, 10);
  return tx.notification.create({
    data: {
      userId: providerId,
      bookingId: booking.id,
      type: NEW_BOOKING_REQUEST,
      message: `${customerName} requested "${serviceTitle}" on ${date}.`,
    },
  });
}

module.exports = { NEW_BOOKING_REQUEST, notifyProviderOfNewBooking };
