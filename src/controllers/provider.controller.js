const prisma = require("../lib/prisma");
const { BookingStatus } = require("../utils/bookingStatus");

// Booking statuses that should NOT count toward the monthly total
const EXCLUDED_STATUSES = [BookingStatus.CANCELLED];

// An unanswered request expires 24 hours after it was made (US6-2). Kept in
// step with BOOKING_RESPONSE_WINDOW_MS, which the PATCH status endpoint enforces.
const RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

const ALL_STATUSES = Object.values(BookingStatus);

// rateUnit is nullable (services created before it existed); those were per hour.
const DEFAULT_RATE_UNIT = "hour";

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
        rateUnit: true,
        startTime: true,
        endTime: true,
        coverPhotoUrl: true,
        isPublished: true,
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
    const data = services.map(({ _count, rate, rateUnit, isPublished, ...service }) => ({
      ...service,
      rate: Number(rate), // Prisma Decimal would otherwise serialize as a string
      rateUnit: rateUnit || DEFAULT_RATE_UNIT,
      status: isPublished ? "PUBLISHED" : "UNPUBLISHED",
      bookingsThisMonth: _count.bookings,
    }));

    return res.status(200).json(data);
  } catch (err) {
    console.error("getMyServices error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// "WAITING_FOR_CONFIRMATION,CONFIRMED" -> ["WAITING_FOR_CONFIRMATION", "CONFIRMED"].
// No value means every status; null when any value isn't a BookingStatus.
function parseStatusFilter(value) {
  if (value === undefined || value === "") return ALL_STATUSES;
  if (typeof value !== "string") return null;
  const statuses = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (statuses.length === 0 || statuses.some((status) => !ALL_STATUSES.includes(status))) return null;
  return statuses;
}

// GET /api/providers/me/booking-requests[?status=WAITING_FOR_CONFIRMATION,CONFIRMED]
// Booking requests for the signed-in provider's services, newest first, for
// the provider's "Booking requests" page (US6-2). Accept / reject goes through
// PATCH /api/bookings/:id/status.
async function getMyBookingRequests(req, res) {
  try {
    const { userId } = req.user; // attached by authenticateToken

    const provider = await prisma.provider.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (!provider) {
      return res.status(403).json({ error: "Provider access only." });
    }

    const statuses = parseStatusFilter(req.query.status);
    if (!statuses) {
      return res.status(400).json({ error: `status must be one or more of: ${ALL_STATUSES.join(", ")}` });
    }

    const bookings = await prisma.booking.findMany({
      where: { service: { providerId: userId }, bookingStatus: { in: statuses } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        bookingStatus: true,
        appointmentDate: true,
        startTime: true,
        endTime: true,
        totalPrice: true,
        createdAt: true,
        service: { select: { id: true, title: true, location: true } },
        customer: {
          select: { user: { select: { firstname: true, lastname: true, profilePhotoUrl: true } } },
        },
      },
    });

    const bookingRequests = bookings.map(({ appointmentDate, totalPrice, createdAt, customer, ...booking }) => ({
      ...booking,
      appointmentDate: appointmentDate.toISOString().slice(0, 10),
      totalPrice: totalPrice === null ? null : Number(totalPrice),
      createdAt: createdAt.toISOString(),
      // When the provider has to answer by; null once the request is answered
      respondBy:
        booking.bookingStatus === BookingStatus.WAITING_FOR_CONFIRMATION
          ? new Date(createdAt.getTime() + RESPONSE_WINDOW_MS).toISOString()
          : null,
      customer: customer.user,
    }));

    return res.status(200).json({ bookingRequests });
  } catch (err) {
    console.error("getMyBookingRequests error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// GET /api/providers/me/services/:id (US4-3)
// One of the signed-in provider's own services, for the edit page. Unlike
// GET /api/services/:id it also returns unpublished services, the category
// ids, and how many requests are pending and bookings confirmed.
async function getMyService(req, res) {
  try {
    const { userId } = req.user; // attached by authenticateToken

    const service = await prisma.service.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        providerId: true,
        title: true,
        description: true,
        location: true,
        rate: true,
        rateUnit: true,
        startTime: true,
        endTime: true,
        coverPhotoUrl: true,
        isPublished: true,
        serviceCategories: { select: { categoryId: true } },
      },
    });
    if (!service) {
      return res.status(404).json({ error: "Service not found." });
    }
    if (service.providerId !== userId) {
      return res.status(403).json({ error: "You can only edit your own services." });
    }

    const [pendingRequestCount, confirmedBookingCount] = await Promise.all([
      // Same rule the unpublish check uses, so the two numbers agree
      prisma.booking.count({
        where: {
          serviceId: service.id,
          bookingStatus: BookingStatus.WAITING_FOR_CONFIRMATION,
          createdAt: { gt: new Date(Date.now() - RESPONSE_WINDOW_MS) },
        },
      }),
      prisma.booking.count({
        where: { serviceId: service.id, bookingStatus: { in: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS] } },
      }),
    ]);

    const { serviceCategories, isPublished, rate, rateUnit, ...rest } = service;
    return res.status(200).json({
      service: {
        ...rest,
        rate: Number(rate), // Prisma Decimal would otherwise serialize as a string
        rateUnit: rateUnit || DEFAULT_RATE_UNIT,
        status: isPublished ? "PUBLISHED" : "UNPUBLISHED",
        categoryIds: serviceCategories.map((link) => link.categoryId),
        pendingRequestCount,
        confirmedBookingCount,
      },
    });
  } catch (err) {
    console.error("getMyService error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// US8-2: page size for a provider's reviews, and the most a client may ask for
const REVIEWS_DEFAULT_LIMIT = 6;
const REVIEWS_MAX_LIMIT = 50;

// A positive whole number from the query string, or the fallback when it's
// missing or not one ("abc", "0", "-2", "1.5").
function positiveInt(value, fallback) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return fallback;
  const number = Number(value);
  return number >= 1 ? number : fallback;
}

// GET /api/providers/:id/reviews?page=1&limit=6 (US8-2) — public. One page of
// the reviews on all of the provider's services, newest first, plus the
// average and count over every review. A page past the end returns the last.
// 404 when the user doesn't exist, was deleted, or isn't a provider.
async function getProviderReviews(req, res) {
  try {
    const provider = await prisma.provider.findUnique({
      where: { userId: req.params.id },
      select: { userId: true, user: { select: { deletedAt: true } } },
    });
    if (!provider || provider.user.deletedAt) {
      return res.status(404).json({ error: "Provider not found." });
    }

    const where = { booking: { service: { providerId: provider.userId } } };
    const limit = Math.min(positiveInt(req.query.limit, REVIEWS_DEFAULT_LIMIT), REVIEWS_MAX_LIMIT);
    const { _avg, _count } = await prisma.review.aggregate({ where, _avg: { rating: true }, _count: true });
    const totalPages = Math.max(1, Math.ceil(_count / limit));
    const currentPage = Math.min(positiveInt(req.query.page, 1), totalPages);

    const reviews = await prisma.review.findMany({
      where,
      // id breaks ties, so two reviews posted at the same moment never swap pages
      orderBy: [{ timestamp: "desc" }, { id: "asc" }],
      skip: (currentPage - 1) * limit,
      take: limit,
      select: {
        id: true,
        rating: true,
        comment: true,
        timestamp: true,
        customer: { select: { user: { select: { firstname: true } } } },
        booking: { select: { service: { select: { title: true } } } },
      },
    });

    return res.status(200).json({
      // Same shape as the reviews in GET /api/users/:id
      reviews: reviews.map((review) => ({
        id: review.id,
        author: review.customer.user.firstname,
        rating: review.rating,
        comment: review.comment,
        date: review.timestamp,
        serviceTitle: review.booking.service.title,
      })),
      summary: {
        avgRating: _count === 0 ? null : Math.round(_avg.rating * 10) / 10,
        reviewCount: _count,
      },
      meta: { totalCount: _count, currentPage, totalPages, limit },
    });
  } catch (err) {
    console.error("getProviderReviews error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { getMyServices, getMyService, getMyBookingRequests, getProviderReviews };