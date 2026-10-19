const prisma = require("../lib/prisma");
const { changeBookingStatus } = require("./booking.service");
const { BookingStatus, BOOKING_RESPONSE_WINDOW_MS, isUnansweredBookingExpired } = require("../utils/bookingStatus");

// Recheck under the same row lock used by provider decisions. A decision or
// another worker may have handled this booking since the candidate query.
async function expireUnansweredBooking(bookingId) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: { bookingStatus: true, createdAt: true },
    });
    if (!booking || !isUnansweredBookingExpired(booking)) return null;
    return changeBookingStatus(bookingId, BookingStatus.EXPIRED, { client: tx });
  });
}

async function expireUnansweredBookings() {
  const cutoff = new Date(Date.now() - BOOKING_RESPONSE_WINDOW_MS);
  let cursor;
  let expired = 0;
  // Bound memory and transaction size, including when catching up after downtime.
  while (true) {
    const candidates = await prisma.booking.findMany({
      where: {
        bookingStatus: BookingStatus.WAITING_FOR_CONFIRMATION,
        createdAt: { lte: cutoff },
        // Processed rows leave the waiting set; continue strictly after the
        // previous ID so changing or deleting that row cannot skip a candidate.
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 100,
    });
    for (const { id } of candidates) {
      if (await expireUnansweredBooking(id)) expired += 1;
    }
    if (candidates.length < 100) return expired;
    cursor = candidates[candidates.length - 1].id;
  }
}

module.exports = { expireUnansweredBooking, expireUnansweredBookings };
