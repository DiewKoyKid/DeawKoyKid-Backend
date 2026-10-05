const prisma = require("../lib/prisma");

// Booking statuses that should NOT count toward the monthly total
// (adjust to match the values you actually store in bookingStatus)
const EXCLUDED_STATUSES = ["CANCELLED"];

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
        description: true,
        location: true,
        rate: true,
        serviceCategories: {
          select: { category: { select: { id: true, category: true } } },
        },
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

    // Flatten the response shape for the frontend
    const data = services.map(({ _count, serviceCategories, ...service }) => ({
      ...service,
      categories: serviceCategories.map((sc) => sc.category),
      bookingCountThisMonth: _count.bookings,
    }));

    return res.status(200).json({ services: data });
  } catch (err) {
    console.error("getMyServices error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { getMyServices };