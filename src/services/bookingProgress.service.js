const prisma = require("../lib/prisma");
const { changeBookingStatus } = require("./booking.service");
const { BookingStatus, hasBookingStarted } = require("../utils/bookingStatus");

// Today's date (server timezone) at UTC midnight, comparable with @db.Date
// columns. Same rule as "today" when booking.
function today(now = Date.now()) {
  const date = new Date(now);
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

// US6-5: moves one confirmed booking to IN_PROGRESS once its start time has
// passed. Rechecks under the row lock used by every status change, so a cancel
// or another worker that got there first wins. Resolves to the change, or
// null when there was nothing to do. IN_PROGRESS sends no notification.
async function startConfirmedBooking(bookingId) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: { bookingStatus: true, appointmentDate: true, startTime: true },
    });
    if (!booking || booking.bookingStatus !== BookingStatus.CONFIRMED || !hasBookingStarted(booking)) return null;
    return changeBookingStatus(bookingId, BookingStatus.IN_PROGRESS, { client: tx });
  });
}

// Every confirmed booking whose start time has passed, in batches of 100 so
// memory and transactions stay small, including when catching up after downtime.
// Resolves to how many bookings were moved.
async function startConfirmedBookings() {
  let cursor;
  let started = 0;
  while (true) {
    const candidates = await prisma.booking.findMany({
      where: {
        bookingStatus: BookingStatus.CONFIRMED,
        // Only today and earlier can have started; the exact time is checked below
        appointmentDate: { lte: today() },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, appointmentDate: true, startTime: true },
      orderBy: { id: "asc" },
      take: 100,
    });
    for (const candidate of candidates) {
      if (hasBookingStarted(candidate) && (await startConfirmedBooking(candidate.id))) started += 1;
    }
    if (candidates.length < 100) return started;
    cursor = candidates[candidates.length - 1].id;
  }
}

module.exports = { startConfirmedBooking, startConfirmedBookings };
