const { getChatAccess, listMessages } = require("../services/chat.service");

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

module.exports = { getBookingMessages };
