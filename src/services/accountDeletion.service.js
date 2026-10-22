const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { hashPassword } = require("../utils/hash");
const { ACTIVE_BOOKING_STATUSES } = require("../utils/bookingStatus");

// Thrown when the user still has a booking in progress. `bookings` is what
// the client shows so the user knows what to finish or cancel first.
class ActiveBookingsError extends Error {
  constructor(bookings) {
    super("account has bookings in progress");
    this.bookings = bookings;
  }
}

// Active bookings the user is part of, as the customer or as the provider of
// the booked service.
function findActiveBookings(client, userId) {
  return client.booking.findMany({
    where: {
      bookingStatus: { in: ACTIVE_BOOKING_STATUSES },
      OR: [{ customerId: userId }, { service: { providerId: userId } }],
    },
    select: {
      id: true,
      bookingStatus: true,
      appointmentDate: true,
      service: { select: { title: true } },
    },
    orderBy: { appointmentDate: "asc" },
  });
}

// US2-3 (F12): soft-deletes the account. The row stays so bookings, reviews,
// chat logs and reports still resolve, but everything that identifies the
// person is wiped, their services come off the listings and their
// notifications go. The caller re-authenticates the user first.
//
// Resolves to the user as it was before the wipe (email, firstname,
// profilePhotoUrl) for the after-commit steps, or to null when the user
// doesn't exist or is already deleted. Throws ActiveBookingsError instead
// of deleting while a booking is in progress.
async function deleteAccount(userId) {
  // Nobody knows this password, so the old one stops working even if
  // something skips the deletedAt check. Hashed outside the transaction
  // to keep the locks short.
  const unusablePassword = await hashPassword(crypto.randomBytes(32).toString("hex"));

  return prisma.$transaction(async (tx) => {
    // Lock the user so two deletion requests queue here, then lock their
    // services so a booking for one can't be created between the check below
    // and the commit (booking creation takes the same service lock).
    await tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true, firstname: true, profilePhotoUrl: true, deletedAt: true },
    });
    if (!user || user.deletedAt) return null;
    await tx.$queryRaw`SELECT 1 FROM "services" WHERE "providerId" = ${userId} FOR UPDATE`;

    const activeBookings = await findActiveBookings(tx, userId);
    if (activeBookings.length > 0) throw new ActiveBookingsError(activeBookings);

    await tx.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        username: `deleted_${userId}`,
        email: null, // frees the address so they can register again
        password: unusablePassword,
        firstname: "Deleted",
        lastname: "User",
        gender: null,
        bdate: null,
        bankAccount: null,
        phoneNumber: null,
        instagram: null,
        line: null,
        facebook: null,
        profilePhotoUrl: null,
        consentAt: null,
      },
    });
    // No-op for customers. avgRating stays: it belongs to the reviews.
    await tx.provider.updateMany({
      where: { userId },
      data: {
        idCard: null,
        bio: null,
        languages: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        interests: [],
        serviceArea: [],
      },
    });
    await tx.service.updateMany({ where: { providerId: userId }, data: { isPublished: false } });
    await tx.notification.deleteMany({ where: { userId } });

    const { deletedAt, ...before } = user;
    return before;
  });
}

module.exports = { ActiveBookingsError, deleteAccount };
