const prisma = require("../lib/prisma");

// Column limits from the services table in prisma/schema.prisma
const TITLE_MAX = 150;
const LOCATION_MAX = 200;
// Decimal(10, 2) holds at most 8 digits before the point
const RATE_MAX = 99999999.99;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

const RATE_UNITS = ["hour", "day"];
// "HH:MM", 00:00-23:59. Zero-padded, so times compare correctly as strings.
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const isGiven = (value) => value !== undefined && value !== null && value !== "";

// Returns { field, message } for the first invalid field, or null when the body is valid
function validateServiceBody({
  title,
  description,
  location,
  rate,
  rateUnit,
  startTime,
  endTime,
  coverPhotoUrl,
  categoryIds,
}) {
  const invalid = (field, message) => ({ field, message });

  if (!isNonEmptyString(title)) return invalid("title", "title is required");
  if (title.trim().length > TITLE_MAX) {
    return invalid("title", `title must be at most ${TITLE_MAX} characters`);
  }
  if (!isNonEmptyString(location)) return invalid("location", "location is required");
  if (location.trim().length > LOCATION_MAX) {
    return invalid("location", `location must be at most ${LOCATION_MAX} characters`);
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    return invalid("description", "description must be a string");
  }
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > RATE_MAX) {
    return invalid("rate", "rate must be a positive number");
  }
  // Compare with a tolerance: in floating point 19.99 * 100 is 1998.9999999999998,
  // so an exact check would reject valid two-decimal rates.
  if (Math.abs(Math.round(rate * 100) - rate * 100) > 1e-6) {
    return invalid("rate", "rate must have at most 2 decimal places");
  }
  if (isGiven(rateUnit) && !RATE_UNITS.includes(rateUnit)) {
    return invalid("rateUnit", 'rateUnit must be "hour" or "day"');
  }

  // Service hours are optional, but come as a pair and end after they start.
  if (isGiven(startTime) && !TIME_PATTERN.test(startTime)) {
    return invalid("startTime", "startTime must be a time like 09:00");
  }
  if (isGiven(endTime) && !TIME_PATTERN.test(endTime)) {
    return invalid("endTime", "endTime must be a time like 17:00");
  }
  if (isGiven(startTime) !== isGiven(endTime)) {
    return invalid(isGiven(startTime) ? "endTime" : "startTime", "startTime and endTime go together");
  }
  if (isGiven(startTime) && endTime <= startTime) {
    return invalid("endTime", "endTime must be after startTime");
  }

  if (isGiven(coverPhotoUrl) && typeof coverPhotoUrl !== "string") {
    return invalid("coverPhotoUrl", "coverPhotoUrl must be a string");
  }
  if (
    categoryIds !== undefined &&
    (!Array.isArray(categoryIds) || categoryIds.some((id) => typeof id !== "string"))
  ) {
    return invalid("categoryIds", "categoryIds must be an array of category ids");
  }
  return null;
}

// 400 body: `error` for a single message, `errors` per field for forms.
function badRequest(res, { field, message }) {
  return res.status(400).json({ error: message, errors: { [field]: message } });
}

// POST /api/services
async function createService(req, res) {
  try {
    const { userId } = req.user; // attached by authenticateToken

    // Any provider can publish; there is no approval step.
    const provider = await prisma.provider.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (!provider) {
      return res.status(403).json({ error: "Provider access only." });
    }

    const problem = validateServiceBody(req.body || {});
    if (problem) {
      return badRequest(res, problem);
    }

    const { title, description, location, rate, rateUnit, startTime, endTime, coverPhotoUrl } =
      req.body;
    const categoryIds = [...new Set(req.body.categoryIds ?? [])];

    if (categoryIds.length > 0) {
      const known = await prisma.category.count({ where: { id: { in: categoryIds } } });
      if (known !== categoryIds.length) {
        return badRequest(res, { field: "categoryIds", message: "categoryIds contains an unknown category" });
      }
    }

    const service = await prisma.service.create({
      data: {
        providerId: userId,
        title: title.trim(),
        description: description?.trim() || null,
        location: location.trim(),
        rate,
        rateUnit: rateUnit || "hour",
        startTime: isGiven(startTime) ? startTime : null,
        endTime: isGiven(endTime) ? endTime : null,
        coverPhotoUrl: isGiven(coverPhotoUrl) ? coverPhotoUrl : null,
        serviceCategories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
      },
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
        serviceCategories: { select: { categoryId: true } },
      },
    });

    const { serviceCategories, ...created } = service;
    return res.status(201).json({
      service: {
        ...created,
        rate: Number(created.rate), // Decimal would serialize as a string
        categoryIds: serviceCategories.map((link) => link.categoryId),
      },
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
// GET /api/services/search
async function searchServices(req, res) {
  try {
    const {
      q,
      gender,
      minAge,
      maxAge,
      // The search page sends the category chips as `interests` (the URL
      // parameter in the filter design); `categories` works as well.
      interests,
      categories = interests,
      minPrice,
      maxPrice,
      minRating,
      page = "1",
      limit = "10",
      sortBy = "rating_desc"
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    // Build the "where" clause
    const where = {
      isPublished: true
    };

    // Text search
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { location: { contains: q, mode: 'insensitive' } },
        { provider: { user: { firstname: { contains: q, mode: 'insensitive' } } } },
        { provider: { user: { lastname: { contains: q, mode: 'insensitive' } } } }
      ];
    }

    // Price filter
    if (minPrice || maxPrice) {
      where.rate = {};
      if (minPrice) where.rate.gte = parseFloat(minPrice);
      if (maxPrice) where.rate.lte = parseFloat(maxPrice);
    }

    // Provider filters (gender, age, rating)
    const providerWhere = {};
    const userWhere = {};
    let hasProviderFilter = false;
    let hasUserFilter = false;

    if (minRating) {
      providerWhere.avgRating = { gte: parseFloat(minRating) };
      hasProviderFilter = true;
    }

    // The URL uses the stored codes (gender=M|F|O, as in the filter design);
    // the long names are accepted too. Anything else means "any gender".
    const GENDER_CODES = { M: "M", F: "F", O: "O", Male: "M", Female: "F", Other: "O" };
    const genderCode = GENDER_CODES[gender];
    if (genderCode) {
      userWhere.gender = genderCode;
      hasUserFilter = true;
    }

    if (minAge || maxAge) {
      const today = new Date();
      if (minAge) {
        // e.g. minAge = 20 means born at least 20 years ago (so bdate <= 2006)
        const maxDate = new Date(today.getFullYear() - parseInt(minAge, 10), today.getMonth(), today.getDate());
        userWhere.bdate = { ...userWhere.bdate, lte: maxDate };
        hasUserFilter = true;
      }
      if (maxAge) {
        // e.g. maxAge = 35 means born at most 35 years ago (so bdate >= 1991)
        const minDate = new Date(today.getFullYear() - parseInt(maxAge, 10) - 1, today.getMonth(), today.getDate() + 1);
        userWhere.bdate = { ...userWhere.bdate, gte: minDate };
        hasUserFilter = true;
      }
    }

    if (hasUserFilter) {
      providerWhere.user = userWhere;
      hasProviderFilter = true;
    }
    
    if (hasProviderFilter) {
      where.provider = providerWhere;
    }

    // Category filter
    if (categories) {
      let catArray = [];
      if (Array.isArray(categories)) catArray = categories;
      else if (typeof categories === 'string') catArray = categories.split(',').map(c => c.trim());
      
      if (catArray.length > 0) {
        where.serviceCategories = {
          some: {
            category: {
              category: { in: catArray }
            }
          }
        };
      }
    }

    // Sorting
    let orderBy = {};
    if (sortBy === 'rating_desc') {
      orderBy = { provider: { avgRating: 'desc' } };
    } else if (sortBy === 'price_asc') {
      orderBy = { rate: 'asc' };
    } else if (sortBy === 'price_desc') {
      orderBy = { rate: 'desc' };
    } else {
      orderBy = { id: 'desc' };
    }

    const [services, totalCount] = await Promise.all([
      prisma.service.findMany({
        where,
        orderBy,
        skip,
        take: limitNum,
        select: {
          id: true,
          title: true,
          location: true,
          rate: true,
          rateUnit: true,
          coverPhotoUrl: true,
          provider: {
            select: {
              avgRating: true,
              user: {
                select: {
                  firstname: true,
                  lastname: true,
                  profilePhotoUrl: true
                }
              }
            }
          },
          bookings: {
            select: {
              reviews: { select: { id: true, rating: true } }
            }
          }
        }
      }),
      prisma.service.count({ where })
    ]);

    // Format the result
    const formattedServices = services.map(s => {
      let reviewCount = 0;
      let sumRating = 0;
      s.bookings.forEach(b => {
        reviewCount += b.reviews.length;
        b.reviews.forEach(r => sumRating += r.rating);
      });

      const calculatedAvg = reviewCount > 0 ? sumRating / reviewCount : null;

      return {
        id: s.id,
        title: s.title,
        location: s.location,
        rate: Number(s.rate),
        rateUnit: s.rateUnit,
        coverPhotoUrl: s.coverPhotoUrl,
        provider: {
          firstname: s.provider.user.firstname,
          lastname: s.provider.user.lastname,
          profilePhotoUrl: s.provider.user.profilePhotoUrl,
          avgRating: s.provider.avgRating ? Number(s.provider.avgRating) : calculatedAvg
        },
        reviewCount
      };
    });

    return res.status(200).json({
      data: formattedServices,
      meta: {
        totalCount,
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        limit: limitNum
      }
    });

  } catch (err) {
    console.error("searchServices error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { createService, getServiceById, searchServices };
