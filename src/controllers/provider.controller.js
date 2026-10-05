const prisma = require("../lib/prisma");

// Booking statuses that should NOT count toward the monthly total
// (adjust to match the values you actually store in bookingStatus)
const EXCLUDED_STATUSES = ["CANCELLED"];

// The services table has no rate unit, status or cover photo columns yet.
// Until a migration adds them, every service is shown in search and priced
// per hour, so report that. Replace these with the real columns when they exist.
const DEFAULT_RATE_UNIT = "hour";
const DEFAULT_STATUS = "PUBLISHED";

// Month boundaries in UTC, so @db.Date columns don't shift by a day
// when the server runs in a timezone like Asia/Bangkok (UTC+7)
function getCurrentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
  return { start, end };
}

// GET /api/providers/me/services
async function getMyServices(req, res) {
  try {
    const { userId } = req.user; // attached by authenticateToken

    // Only users with a provider profile may access this endpoint
    const provider = await prisma.provider.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (!provider) {
      return res.status(403).json({ error: "Provider access only." });
    }

    const { start, end } = getCurrentMonthRange();

    const services = await prisma.service.findMany({
      where: { providerId: userId },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        location: true,
        rate: true,
        _count: {
          select: {
            bookings: {
              where: {
                bookingDate: { gte: start, lt: end },
                bookingStatus: { notIn: EXCLUDED_STATUSES },
              },
            },
          },
        },
      },
    });

    // Shape agreed with the frontend (togethr-frontend src/services/sprint2Api.js):
    // a plain array, one object per service, empty when there are none.
    const data = services.map(({ _count, rate, ...service }) => ({
      ...service,
      rate: Number(rate), // Prisma Decimal would otherwise serialize as a string
      rateUnit: DEFAULT_RATE_UNIT,
      coverPhotoUrl: null,
      status: DEFAULT_STATUS,
      bookingsThisMonth: _count.bookings,
    }));

    return res.status(200).json(data);
  } catch (err) {
    console.error("getMyServices error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { getMyServices };