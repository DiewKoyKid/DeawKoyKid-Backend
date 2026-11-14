// The service card shape the search results return (GET /api/services/search).
// The public profile (GET /api/users/:id) lists a provider's services in the
// same shape, so the frontend can show both with one ServiceCard.

const SERVICE_CARD_SELECT = {
  id: true,
  providerId: true,
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
};

// s: a service selected with SERVICE_CARD_SELECT
function toServiceCard(s) {
  let reviewCount = 0;
  let sumRating = 0;
  s.bookings.forEach(b => {
    reviewCount += b.reviews.length;
    b.reviews.forEach(r => sumRating += r.rating);
  });

  // This service's own average (the service page shows the same number). It is
  // null until the service has a review.
  const calculatedAvg = reviewCount > 0 ? Math.round((sumRating / reviewCount) * 100) / 100 : null;

  return {
    id: s.id,
    title: s.title,
    location: s.location,
    rate: Number(s.rate),
    rateUnit: s.rateUnit,
    coverPhotoUrl: s.coverPhotoUrl,
    provider: {
      id: s.providerId,
      firstname: s.provider.user.firstname,
      lastname: s.provider.user.lastname,
      profilePhotoUrl: s.provider.user.profilePhotoUrl,
      avgRating: s.provider.avgRating ? Number(s.provider.avgRating) : calculatedAvg
    },
    avgRating: calculatedAvg,
    reviewCount
  };
}

module.exports = { SERVICE_CARD_SELECT, toServiceCard };
