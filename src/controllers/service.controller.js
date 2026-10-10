const prisma = require("../lib/prisma");

// Column limits from the services table in prisma/schema.prisma
const TITLE_MAX = 150;
const LOCATION_MAX = 200;
// Decimal(10, 2) holds at most 8 digits before the point
const RATE_MAX = 99999999.99;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Returns an error message for the first invalid field, or null when the body is valid
function validateServiceBody({ title, description, location, rate }) {
  if (!isNonEmptyString(title)) return "title is required";
  if (title.trim().length > TITLE_MAX) return `title must be at most ${TITLE_MAX} characters`;
  if (!isNonEmptyString(location)) return "location is required";
  if (location.trim().length > LOCATION_MAX) {
    return `location must be at most ${LOCATION_MAX} characters`;
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    return "description must be a string";
  }
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > RATE_MAX) {
    return "rate must be a positive number";
  }
  if (Math.round(rate * 100) !== rate * 100) return "rate must have at most 2 decimal places";
  return null;
}

// POST /api/services
async function createService(req, res) {
  try {
    const { userId } = req.user; // attached by authenticateToken

    const provider = await prisma.provider.findUnique({
      where: { userId },
      select: { status: true },
    });
    if (!provider) {
      return res.status(403).json({ error: "Provider access only." });
    }
    if (provider.status !== "APPROVED") {
      return res.status(403).json({ error: "Only approved providers can create services." });
    }

    const error = validateServiceBody(req.body || {});
    if (error) {
      return res.status(400).json({ error });
    }

    const { title, description, location, rate } = req.body;
    const service = await prisma.service.create({
      data: {
        providerId: userId,
        title: title.trim(),
        description: description?.trim() || null,
        location: location.trim(),
        rate,
      },
      select: {
        id: true,
        providerId: true,
        title: true,
        description: true,
        location: true,
        rate: true,
      },
    });

    return res.status(201).json({
      service: { ...service, rate: Number(service.rate) }, // Decimal would serialize as a string
    });
  } catch (err) {
    console.error("createService error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// GET /api/services/:id
async function getServiceById(req, res) {
  try {
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
        serviceCategories: {
          select: { category: { select: { category: true } } },
        },
        provider: {
          select: {
            avgRating: true,
            user: { select: { firstname: true, lastname: true, profilePhotoUrl: true } },
          },
        },
        bookings: {
          select: {
            reviews: {
              select: {
                id: true,
                rating: true,
                comment: true,
                timestamp: true,
                customer: {
                  select: { user: { select: { firstname: true } } }
                }
              }
            }
          }
        }
      },
    });
    if (!service) {
      return res.status(404).json({ error: "Service not found." });
    }
    // The provider took it down; it existed, so say so rather than "not found"
    if (!service.isPublished) {
      return res.status(410).json({ error: "This service is no longer available." });
    }

    const { isPublished, provider, rate, serviceCategories, bookings, ...rest } = service;

    // Flatten categories
    const categories = serviceCategories.map((c) => c.category.category);

    // Extract all reviews from bookings
    const reviews = [];
    bookings.forEach((booking) => {
      booking.reviews.forEach((review) => {
        reviews.push({
          id: review.id,
          author: review.customer.user.firstname,
          rating: review.rating,
          comment: review.comment,
          date: review.timestamp,
        });
      });
    });

    return res.status(200).json({
      service: {
        ...rest,
        rate: Number(rate), // Decimal would serialize as a string
        categories,
        reviewCount: reviews.length,
        reviews, // Note: returning reviews here so the frontend can use them
        provider: {
          firstname: provider.user.firstname,
          lastname: provider.user.lastname,
          profilePhotoUrl: provider.user.profilePhotoUrl,
          avgRating: provider.avgRating === null ? null : Number(provider.avgRating),
        },
      },
    });
  } catch (err) {
    console.error("getServiceById error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { createService, getServiceById };
