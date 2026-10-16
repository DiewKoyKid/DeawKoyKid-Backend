const prisma = require("../lib/prisma");
const { notifyBookingStatusChange } = require("./notification.service");

const BOOKING_FIELDS = {
  id: true,
  serviceId: true,
  customerId: true,
  bookingDate: true,
  appointmentDate: true,
  startTime: true,
  endTime: true,
  bookingStatus: true,
  duration: true,
  totalPrice: true,
};

// The one place a booking's status should change, so the F52 notification
// hook always runs with it. It only applies the change: who may make which
// transition (F47) and the 24-hour expiry rule (F48) are for the caller.
//
// `client` is prisma or an interactive transaction client; with prisma the
// change gets its own transaction. Resolves to null when the booking doesn't
// exist, otherwise to { booking, notifications } (no notifications when the
// booking already had that status).
function changeBookingStatus(bookingId, nextStatus, { actorId = null, client = prisma } = {}) {
  const run = (tx) => applyStatusChange(tx, bookingId, nextStatus, actorId);
  return client.$transaction ? client.$transaction(run) : run(client);
}

async function applyStatusChange(tx, bookingId, nextStatus, actorId) {
  // Lock the booking row so two simultaneous changes queue here instead of
  // both reading the old status and both sending notifications.
  await tx.$queryRaw`SELECT 1 FROM "bookings" WHERE "id" = ${bookingId} FOR UPDATE`;

  const current = await tx.booking.findUnique({
    where: { id: bookingId },
    select: { ...BOOKING_FIELDS, service: { select: { title: true, providerId: true } } },
  });
  if (!current) return null;

  const { service, ...unchanged } = current;
  if (unchanged.bookingStatus === nextStatus) return { booking: unchanged, notifications: [] };

  const booking = await tx.booking.update({
    where: { id: bookingId },
    data: { bookingStatus: nextStatus },
    select: BOOKING_FIELDS,
  });
  const notifications = await notifyBookingStatusChange(tx, {
    booking,
    providerId: service.providerId,
    serviceTitle: service.title,
    actorId,
  });
  return { booking, notifications };
}

module.exports = { changeBookingStatus };
