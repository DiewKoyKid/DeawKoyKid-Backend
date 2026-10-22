const { Prisma } = require("@prisma/client");
const prisma = require("../lib/prisma");
const { BookingStatus } = require("../utils/bookingStatus");

const MAX_COMMENT_LENGTH = 1000;
const ALREADY_REVIEWED = "You have already reviewed this booking.";

// Average of every review on the provider's services, rounded half-up to the
// 2 decimals Provider.avgRating stores. Summed as integers and divided as a
// Decimal so the rounding doesn't depend on floating point.
async function recalculateAvgRating(tx, providerId) {
  const { _sum, _count } = await tx.review.aggregate({
    where: { booking: { service: { providerId } } },
    _sum: { rating: true },
    _count: true,
  });
  const avgRating = _count === 0
    ? null
    : new Prisma.Decimal(_sum.rating).div(_count).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  await tx.provider.update({ where: { userId: providerId }, data: { avgRating } });
  return { id: providerId, avgRating: avgRating === null ? null : avgRating.toNumber(), reviewCount: _count };
}

// POST /api/reviews (US8-1) — the customer rates a completed booking, once.
async function createReview(req, res) {
  const { bookingId, rating, comment } = req.body || {};

  if (typeof bookingId !== "string" || bookingId.trim() === "") {
    return res.status(400).json({ error: "bookingId is required" });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "rating must be a whole number from 1 to 5" });
  }
  if (comment !== undefined && comment !== null && typeof comment !== "string") {
    return res.status(400).json({ error: "comment must be a string" });
  }
  const trimmedComment = typeof comment === "string" ? comment.trim() : "";
  if (trimmedComment.length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({ error: `comment must be at most ${MAX_COMMENT_LENGTH} characters` });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the booking so two submissions for it queue here and the second
      // sees the first one's review.
      await tx.$queryRaw`SELECT 1 FROM "bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { customerId: true, bookingStatus: true, service: { select: { providerId: true } } },
      });
      if (!booking) {
        return { statusCode: 404, error: "Booking not found." };
      }
      if (booking.customerId !== req.user.userId) {
        return { statusCode: 403, error: "You can only review your own bookings." };
      }
      // No "paid" check: this project has no payment step (Sprint 3 backlog note)
      if (booking.bookingStatus !== BookingStatus.COMPLETED) {
        return { statusCode: 400, error: "You can review a booking only after it is completed" };
      }
      const existing = await tx.review.findUnique({ where: { bookingId }, select: { id: true } });
      if (existing) {
        return { statusCode: 409, error: ALREADY_REVIEWED };
      }

      const review = await tx.review.create({
        data: {
          bookingId,
          customerId: req.user.userId,
          rating,
          comment: trimmedComment || null,
        },
        select: { id: true, bookingId: true, rating: true, comment: true, timestamp: true },
      });

      // Lock the provider too: reviews of their other bookings can commit at
      // the same time, and each must average over the others' rows.
      const { providerId } = booking.service;
      await tx.$queryRaw`SELECT 1 FROM "providers" WHERE "userId" = ${providerId} FOR UPDATE`;
      const provider = await recalculateAvgRating(tx, providerId);

      return { review, provider };
    });

    if (result.error) return res.status(result.statusCode).json({ error: result.error });
    return res.status(201).json(result);
  } catch (err) {
    // The unique bookingId index is the backstop if two submissions still race
    if (err.code === "P2002") {
      return res.status(409).json({ error: ALREADY_REVIEWED });
    }
    console.error("createReview error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { createReview };
