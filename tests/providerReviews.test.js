// GET /api/providers/:id/reviews (US8-2): the paged reviews section on a
// provider's public profile. Uses the database, like review.test.js.
require("dotenv").config();
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");

const createdUsernames = [];
const createdServiceIds = [];

function uniqueUser(prefix) {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const username = `${prefix}_${suffix}`;
  createdUsernames.push(username);
  return {
    username,
    email: `${username}@example.com`,
    password: "correct-horse-battery-staple",
    firstname: "Test",
    lastname: "User",
    consent: true,
  };
}

afterAll(async () => {
  // Reviews, bookings and services don't cascade from users, so remove them first
  await prisma.review.deleteMany({ where: { booking: { serviceId: { in: createdServiceIds } } } });
  await prisma.booking.deleteMany({ where: { serviceId: { in: createdServiceIds } } });
  await prisma.service.deleteMany({ where: { id: { in: createdServiceIds } } });
  await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
  await prisma.$disconnect();
});

async function register(payload, registerPath = "/api/auth/register") {
  const agent = request.agent(app);
  await agent.post(registerPath).send(payload);
  const loginRes = await agent.post("/api/auth/login").send({ email: payload.email, password: payload.password });
  return loginRes.body.user;
}

function customer(firstname = "Nina") {
  return register({ ...uniqueUser("pr_customer"), firstname });
}

async function providerWithService(title = "Old Town street food walk") {
  const user = await register({ ...uniqueUser("pr_provider"), idCard: "1234567890123" }, "/api/auth/register/provider");
  const service = await prisma.service.create({
    data: { providerId: user.id, title, location: "Bangkok", rate: 450 },
  });
  createdServiceIds.push(service.id);
  return { user, service };
}

// A completed booking with a review, posted `minutesAgo` minutes ago
async function addReview(service, author, rating, minutesAgo, comment = null) {
  const booking = await prisma.booking.create({
    data: {
      serviceId: service.id,
      customerId: author.id,
      bookingDate: new Date("2026-10-01"),
      appointmentDate: new Date("2026-10-10"),
      bookingStatus: "COMPLETED",
    },
  });
  return prisma.review.create({
    data: {
      bookingId: booking.id,
      customerId: author.id,
      rating,
      comment,
      timestamp: new Date(Date.now() - minutesAgo * 60 * 1000),
    },
  });
}

function reviewsOf(providerId, query = "") {
  return request(app).get(`/api/providers/${providerId}/reviews${query}`);
}

describe("GET /api/providers/:id/reviews", () => {
  it("returns 404 for an unknown user and for a customer", async () => {
    expect((await reviewsOf("no-such-user")).status).toBe(404);
    const nina = await customer();
    const res = await reviewsOf(nina.id);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Provider not found.");
  });

  it("returns an empty first page when the provider has no reviews", async () => {
    const { user } = await providerWithService();
    const res = await reviewsOf(user.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reviews: [],
      summary: { avgRating: null, reviewCount: 0 },
      meta: { totalCount: 0, currentPage: 1, totalPages: 1, limit: 6 },
    });
  });

  it("pages reviews newest first, with the average over all of them", async () => {
    const { user, service } = await providerWithService();
    const nina = await customer("Nina");
    // 8 reviews, review i posted i minutes ago, so r1 is the newest
    const ratings = [5, 4, 3, 5, 4, 5, 2, 4];
    const created = [];
    for (const [i, rating] of ratings.entries()) {
      created.push(await addReview(service, nina, rating, i + 1, i === 0 ? "Great trip" : null));
    }

    const first = await reviewsOf(user.id);
    expect(first.status).toBe(200);
    expect(first.body.reviews.map((r) => r.id)).toEqual(created.slice(0, 6).map((r) => r.id));
    expect(first.body.reviews[0]).toEqual({
      id: created[0].id,
      author: "Nina",
      rating: 5,
      comment: "Great trip",
      date: created[0].timestamp.toISOString(),
      serviceTitle: "Old Town street food walk",
    });
    // (5+4+3+5+4+5+2+4) / 8 = 4.0
    expect(first.body.summary).toEqual({ avgRating: 4, reviewCount: 8 });
    expect(first.body.meta).toEqual({ totalCount: 8, currentPage: 1, totalPages: 2, limit: 6 });

    const second = await reviewsOf(user.id, "?page=2");
    expect(second.body.reviews.map((r) => r.id)).toEqual(created.slice(6).map((r) => r.id));
    expect(second.body.meta.currentPage).toBe(2);
    // The summary covers every review, not just this page
    expect(second.body.summary).toEqual(first.body.summary);
  });

  it("honours limit, clamps a page past the end, and ignores bad values", async () => {
    const { user, service } = await providerWithService();
    const nina = await customer();
    const created = [];
    for (let i = 0; i < 5; i += 1) created.push(await addReview(service, nina, 4, i + 1));

    const small = await reviewsOf(user.id, "?limit=2&page=3");
    expect(small.body.reviews.map((r) => r.id)).toEqual([created[4].id]);
    expect(small.body.meta).toEqual({ totalCount: 5, currentPage: 3, totalPages: 3, limit: 2 });

    const pastTheEnd = await reviewsOf(user.id, "?limit=2&page=99");
    expect(pastTheEnd.body.meta.currentPage).toBe(3);
    expect(pastTheEnd.body.reviews.map((r) => r.id)).toEqual([created[4].id]);

    for (const query of ["?page=abc&limit=xyz", "?page=0&limit=0", "?page=-1&limit=1.5"]) {
      const res = await reviewsOf(user.id, query);
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ currentPage: 1, limit: 6 });
    }

    const huge = await reviewsOf(user.id, "?limit=1000");
    expect(huge.body.meta.limit).toBe(50);
  });

  it("rounds the average to one decimal and leaves out other providers' reviews", async () => {
    const mine = await providerWithService("Temple morning photo walk");
    const other = await providerWithService();
    const nina = await customer();
    await addReview(mine.service, nina, 5, 1);
    await addReview(mine.service, nina, 4, 2);
    await addReview(mine.service, nina, 4, 3);
    await addReview(other.service, nina, 1, 4);

    const res = await reviewsOf(mine.user.id);
    expect(res.body.reviews).toHaveLength(3);
    expect(res.body.reviews.every((r) => r.serviceTitle === "Temple morning photo walk")).toBe(true);
    // 13 / 3 = 4.333...
    expect(res.body.summary).toEqual({ avgRating: 4.3, reviewCount: 3 });
  });

  it("is public and never exposes the reviewer's private details", async () => {
    const { user, service } = await providerWithService();
    const nina = await customer();
    await addReview(service, nina, 5, 1);
    const res = await reviewsOf(user.id);
    expect(res.status).toBe(200);
    // Only the first name, no user id, email or username
    expect(Object.keys(res.body.reviews[0]).sort()).toEqual(["author", "comment", "date", "id", "rating", "serviceTitle"]);
    expect(JSON.stringify(res.body)).not.toContain(nina.id);
  });
});
