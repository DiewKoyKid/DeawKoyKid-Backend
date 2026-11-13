// Test plan seed (course 2110423). Run with `npm run seed:test` AFTER the
// tester has registered somchai@gmail.com (customer) and somsri@gmail.com
// (provider) through the API. Re-runnable: it first removes everything a
// previous run created, then recreates it. Every seeded row has a fixed id,
// so the ids in the printed table stay the same from run to run.
require("dotenv").config();
const crypto = require("crypto");
const prisma = require("../src/lib/prisma");
const { hashPassword } = require("../src/utils/hash");
const { hashToken } = require("../src/services/passwordReset.service");
const { deleteAccount } = require("../src/services/accountDeletion.service");

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const IDS = {
  nida: "a3000000-0000-4000-8000-000000000001",
  kanya: "a3000000-0000-4000-8000-000000000002",
  deletedUser: "a3000000-0000-4000-8000-000000000003",
  "SV-001": "a0000000-0000-4000-8000-000000000001",
  "SV-002": "a0000000-0000-4000-8000-000000000002",
  "SL-01": "a1000000-0000-4000-8000-000000000001",
  "SL-02": "a1000000-0000-4000-8000-000000000002",
  "SL-03": "a1000000-0000-4000-8000-000000000003",
};
const SEEDED_EMAILS = ["nida@gmail.com", "kanya@gmail.com", "deleted.user@gmail.com"];

const SLOTS = [
  { label: "SL-01", date: "2026-11-20" },
  { label: "SL-02", date: "2026-11-25" },
  { label: "SL-03", date: "2026-11-26" },
];

// createdAtAgo: how long before now the booking was made (default: now)
const BOOKINGS = [
  { label: "BK-1001", status: "WAITING_FOR_CONFIRMATION", date: "2026-12-01", createdAtAgo: HOUR_MS },
  { label: "BK-1002", status: "WAITING_FOR_CONFIRMATION", date: "2026-12-02", createdAtAgo: 25 * HOUR_MS },
  { label: "BK-1003", status: "CONFIRMED", date: "2026-11-25" },
  { label: "BK-1004", status: "CONFIRMED", date: "2026-11-10" },
  { label: "BK-1006", status: "REJECTED", date: "2026-12-03" },
  { label: "BK-1007", status: "WAITING_FOR_CONFIRMATION", date: "2026-12-04", createdAtAgo: HOUR_MS },
  { label: "BK-1008", status: "WAITING_FOR_CONFIRMATION", date: "2026-12-05", createdAtAgo: HOUR_MS },
  { label: "BK-1009", status: "CONFIRMED", date: "2026-11-27" },
  { label: "BK-1010", status: "WAITING_FOR_CONFIRMATION", date: "2026-12-06", createdAtAgo: HOUR_MS },
];
for (const booking of BOOKINGS) {
  IDS[booking.label] = `a2000000-0000-4000-8000-00000000${booking.label.slice(3)}`;
}

// "YYYY-MM-DD" -> Date at UTC midnight, like the booking controller's dates
const day = (value) => new Date(`${value}T00:00:00.000Z`);

// Today's date (server timezone) at UTC midnight, as createBooking stores it
function today() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

async function findRegistered(email, profile) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true, customer: { select: { userId: true } }, provider: { select: { userId: true } } },
  });
  if (!user || user.deletedAt || !user[profile]) {
    const role = profile === "provider" ? "provider (POST /api/auth/register/provider)" : "customer (POST /api/auth/register)";
    throw new Error(`${email} isn't registered as a ${role}. Register it through the API first, then run the seed again.`);
  }
  return user.id;
}

// Removes everything a previous run created, plus what testers added on top of
// it (bookings by the seeded customers, and reviews, complaints and chat on
// the seeded bookings), which would otherwise block the deletes.
async function removePreviousRun(providerId) {
  const seededUsers = await prisma.user.findMany({
    where: { OR: [{ id: { in: [IDS.nida, IDS.kanya, IDS.deletedUser] } }, { email: { in: SEEDED_EMAILS } }] },
    select: { id: true },
  });
  const userIds = seededUsers.map((u) => u.id);
  const serviceIds = [IDS["SV-001"], IDS["SV-002"]];

  const bookings = await prisma.booking.findMany({
    where: { OR: [{ serviceId: { in: serviceIds } }, { customerId: { in: userIds } }] },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);

  await prisma.$transaction([
    prisma.complaint.deleteMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { userId: { in: userIds } }] } }),
    prisma.review.deleteMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { customerId: { in: userIds } }] } }),
    prisma.chatLog.deleteMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { senderId: { in: userIds } }] } }),
    prisma.notification.deleteMany({ where: { bookingId: { in: bookingIds } } }),
    prisma.booking.deleteMany({ where: { id: { in: bookingIds } } }),
    // Slots and category links cascade with their service
    prisma.service.deleteMany({ where: { id: { in: serviceIds } } }),
    prisma.report.deleteMany({ where: { userId: { in: userIds } } }),
    // Customer/provider profiles, notifications and reset tokens cascade
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  ]);

  // Removed reviews no longer count towards somsri's average
  const { _avg } = await prisma.review.aggregate({
    where: { booking: { service: { providerId } } },
    _avg: { rating: true },
  });
  await prisma.provider.update({
    where: { userId: providerId },
    data: { avgRating: _avg.rating === null ? null : Math.round(_avg.rating * 100) / 100 },
  });

  return { users: userIds.length, bookings: bookingIds.length };
}

async function createCustomer({ id, username, email, password, firstname }) {
  return prisma.user.create({
    data: {
      id,
      username,
      email,
      password: await hashPassword(password),
      firstname,
      lastname: "Test",
      consentAt: new Date(),
      customer: { create: {} },
    },
  });
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the test seed with NODE_ENV=production.");
  }

  const somchaiId = await findRegistered("somchai@gmail.com", "customer");
  const somsriId = await findRegistered("somsri@gmail.com", "provider");

  const removed = await removePreviousRun(somsriId);
  console.log(`Removed the previous run: ${removed.users} users, ${removed.bookings} bookings.`);

  await createCustomer({ id: IDS.nida, username: "nida", email: "nida@gmail.com", password: "Nida@2026", firstname: "Nida" });
  await createCustomer({ id: IDS.kanya, username: "kanya", email: "kanya@gmail.com", password: "Kanya@2026", firstname: "Kanya" });

  // Deleted the same way as DELETE /api/users/me, so it ends up anonymised
  // with deletedAt set and the email freed
  await createCustomer({
    id: IDS.deletedUser, username: "deleted_user_seed", email: "deleted.user@gmail.com", password: "Deleted@2026", firstname: "Deleted",
  });
  await deleteAccount(IDS.deletedUser);

  // T2: a reset link for nida issued 16 minutes ago, expired a minute ago.
  // Only the hash is stored, as passwordReset.service.js does.
  const t2 = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  await prisma.passwordResetToken.create({
    data: {
      userId: IDS.nida,
      tokenHash: hashToken(t2),
      createdAt: new Date(now - 16 * MINUTE_MS),
      expiresAt: new Date(now - MINUTE_MS),
    },
  });

  await prisma.service.create({
    data: {
      id: IDS["SV-001"],
      providerId: somsriId,
      title: "Chiang Mai Old Town Walk",
      description: "A morning walk through the temples and lanes inside the old city walls.",
      location: "Chiang Mai",
      rate: 500,
      rateUnit: "hour",
      startTime: "09:00",
      endTime: "12:00",
      isPublished: true,
      availabilitySlots: {
        create: SLOTS.map((slot) => ({ id: IDS[slot.label], date: day(slot.date), startTime: "09:00", endTime: "12:00" })),
      },
    },
  });
  await prisma.service.create({
    data: {
      id: IDS["SV-002"],
      providerId: somsriId,
      title: "Doi Suthep Sunrise Hike",
      description: "Unpublished service for the test plan.",
      location: "Chiang Mai",
      rate: 800,
      rateUnit: "hour",
      startTime: "05:00",
      endTime: "09:00",
      isPublished: false,
    },
  });

  // Inserted directly, so no notifications are created for them
  const bookedOn = today();
  await prisma.booking.createMany({
    data: BOOKINGS.map((booking) => ({
      id: IDS[booking.label],
      serviceId: IDS["SV-001"],
      customerId: somchaiId,
      bookingDate: bookedOn,
      appointmentDate: day(booking.date),
      startTime: "09:00",
      endTime: "12:00",
      bookingStatus: booking.status,
      totalPrice: 1500,
      createdAt: new Date(now - (booking.createdAtAgo ?? 0)),
    })),
  });

  const rows = [
    ["SV-001", IDS["SV-001"]],
    ["SV-002", IDS["SV-002"]],
    ...SLOTS.map((slot) => [slot.label, IDS[slot.label]]),
    ...BOOKINGS.map((booking) => [booking.label, IDS[booking.label]]),
    ["T2", t2],
  ];
  console.log("\nTest plan seed done.\n");
  console.log("Label     Id / raw token");
  console.log("--------  ------------------------------------");
  for (const [label, value] of rows) console.log(`${label.padEnd(8)}  ${value}`);
}

main()
  .catch((err) => {
    console.error(`Test seed failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
