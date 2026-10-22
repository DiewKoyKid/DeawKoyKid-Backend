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

async function registerAndLogin(agent, payload, registerPath = "/api/auth/register") {
  await agent.post(registerPath).send(payload);
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ email: payload.email, password: payload.password });
  return loginRes.body.user;
}

async function loginAsCustomer(prefix = "rv_customer") {
  const agent = request.agent(app);
  const user = await registerAndLogin(agent, uniqueUser(prefix));
  return { agent, user };
}

// A provider with one published service. Reviews are about the provider, so
// each test gets its own to keep avgRating predictable.
async function providerWithService() {
  const payload = { ...uniqueUser("rv_provider"), idCard: "1234567890123" };
  const user = await registerAndLogin(request.agent(app), payload, "/api/auth/register/provider");
  const service = await prisma.service.create({
    data: { providerId: user.id, title: "Old Town street food walk", location: "Bangkok", rate: 450 },
  });
  createdServiceIds.push(service.id);
  return { user, service };
}

// Statuses are set directly: COMPLETED will come from Tong's US6-5 endpoint
function createBooking(serviceId, customerId, bookingStatus = "COMPLETED") {
  return prisma.booking.create({
    data: {
      serviceId,
      customerId,
      bookingDate: new Date("2026-10-01"),
      appointmentDate: new Date("2026-10-10"),
      bookingStatus,
    },
  });
}

function review(agent, body) {
  return agent.post("/api/reviews").send(body);
}

async function avgRatingOf(providerId) {
  const provider = await prisma.provider.findUnique({ where: { userId: providerId } });
  return provider.avgRating === null ? null : Number(provider.avgRating);
}

describe("POST /api/reviews (US8-1)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/reviews").send({ bookingId: "any", rating: 5 });
    expect(res.status).toBe(401);
  });

  describe("eligible booking", () => {
    it("creates the review and sets the provider's avgRating", async () => {
      const { user: provider, service } = await providerWithService();
      const { agent, user } = await loginAsCustomer();
      const booking = await createBooking(service.id, user.id);

      const res = await review(agent, { bookingId: booking.id, rating: 4, comment: "  Great food!  " });

      expect(res.status).toBe(201);
      expect(res.body.review).toMatchObject({ bookingId: booking.id, rating: 4, comment: "Great food!" });
      expect(res.body.review.id).toEqual(expect.any(String));
      expect(Date.parse(res.body.review.timestamp)).not.toBeNaN();
      expect(res.body.provider).toEqual({ id: provider.id, avgRating: 4, reviewCount: 1 });
      expect(await avgRatingOf(provider.id)).toBe(4);
      const stored = await prisma.review.findUnique({ where: { bookingId: booking.id } });
      expect(stored).toMatchObject({ customerId: user.id, rating: 4, comment: "Great food!" });
    });

    it("averages over all of the provider's reviews, rounded to 2 decimals", async () => {
      const { user: provider, service } = await providerWithService();
      const { agent, user } = await loginAsCustomer();
      const other = await loginAsCustomer();
      const first = await createBooking(service.id, user.id);
      const second = await createBooking(service.id, user.id);
      const third = await createBooking(service.id, other.user.id);

      await review(agent, { bookingId: first.id, rating: 4 });
      const secondRes = await review(agent, { bookingId: second.id, rating: 5 });

      expect(secondRes.status).toBe(201);
      expect(secondRes.body.provider).toEqual({ id: provider.id, avgRating: 4.5, reviewCount: 2 });
      expect(await avgRatingOf(provider.id)).toBe(4.5);

      // (4 + 5 + 5) / 3 = 4.666...
      const thirdRes = await review(other.agent, { bookingId: third.id, rating: 5 });
      expect(thirdRes.body.provider).toEqual({ id: provider.id, avgRating: 4.67, reviewCount: 3 });
      expect(await avgRatingOf(provider.id)).toBe(4.67);
    });

    it("stores a missing or blank comment as null", async () => {
      const { service } = await providerWithService();
      const { agent, user } = await loginAsCustomer();
      const withoutComment = await createBooking(service.id, user.id);
      const blankComment = await createBooking(service.id, user.id);

      const first = await review(agent, { bookingId: withoutComment.id, rating: 3 });
      const second = await review(agent, { bookingId: blankComment.id, rating: 3, comment: "   " });

      expect(first.status).toBe(201);
      expect(first.body.review.comment).toBeNull();
      expect(second.status).toBe(201);
      expect(second.body.review.comment).toBeNull();
    });

    it("accepts a 1000-character comment, counted after trimming", async () => {
      const { service } = await providerWithService();
      const { agent, user } = await loginAsCustomer();
      const booking = await createBooking(service.id, user.id);

      const res = await review(agent, { bookingId: booking.id, rating: 5, comment: ` ${"a".repeat(1000)} ` });

      expect(res.status).toBe(201);
      expect(res.body.review.comment).toHaveLength(1000);
    });
  });

  describe("ineligible booking", () => {
    it("refuses a second review of the same booking", async () => {
      const { user: provider, service } = await providerWithService();
      const { agent, user } = await loginAsCustomer();
      const booking = await createBooking(service.id, user.id);
      await review(agent, { bookingId: booking.id, rating: 5 });

      const res = await review(agent, { bookingId: booking.id, rating: 1 });

      expect(res.status).toBe(409);
      expect(await prisma.review.count({ where: { bookingId: booking.id } })).toBe(1);
      expect(await avgRatingOf(provider.id)).toBe(5);
    });

    it("keeps one review when two submissions arrive at once", async () => {
      const { service } = await providerWithService();
      const { agent, user } = await loginAsCustomer();
      const booking = await createBooking(service.id, user.id);

      const responses = await Promise.all([
        review(agent, { bookingId: booking.id, rating: 5 }),
        review(agent, { bookingId: booking.id, rating: 4 }),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.review.count({ where: { bookingId: booking.id } })).toBe(1);
    });

    it("refuses a booking that isn't completed yet", async () => {
      const { user: provider, service } = await providerWithService();
      const { agent, user } = await loginAsCustomer();
      const booking = await createBooking(service.id, user.id, "CONFIRMED");

      const res = await review(agent, { bookingId: booking.id, rating: 5 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("You can review a booking only after it is completed");
      expect(await prisma.review.count({ where: { bookingId: booking.id } })).toBe(0);
      expect(await avgRatingOf(provider.id)).toBeNull();
    });

    it("refuses someone else's booking", async () => {
      const { service } = await providerWithService();
      const owner = await loginAsCustomer();
      const { agent } = await loginAsCustomer();
      const booking = await createBooking(service.id, owner.user.id);

      const res = await review(agent, { bookingId: booking.id, rating: 5 });

      expect(res.status).toBe(403);
      expect(await prisma.review.count({ where: { bookingId: booking.id } })).toBe(0);
    });

    it("returns 404 for a booking that doesn't exist", async () => {
      const { agent } = await loginAsCustomer();

      const res = await review(agent, { bookingId: "00000000-0000-0000-0000-000000000000", rating: 5 });

      expect(res.status).toBe(404);
    });
  });

  describe("validation", () => {
    let agent;
    let booking;

    // Every request here targets an eligible booking, so nothing but the
    // invalid field stops it
    beforeAll(async () => {
      const { service } = await providerWithService();
      const customer = await loginAsCustomer();
      agent = customer.agent;
      booking = await createBooking(service.id, customer.user.id);
    });

    async function expectRejected(body, field) {
      const res = await review(agent, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(field);
      expect(await prisma.review.count({ where: { bookingId: booking.id } })).toBe(0);
    }

    it.each([0, 6, 3.5, "5", null, undefined])("rejects rating %p", async (rating) => {
      await expectRejected({ bookingId: booking.id, rating }, /rating/);
    });

    it("rejects a missing bookingId", async () => {
      await expectRejected({ rating: 5 }, /bookingId/);
    });

    it("rejects a comment that isn't a string", async () => {
      await expectRejected({ bookingId: booking.id, rating: 5, comment: 42 }, /comment/);
    });

    it("rejects a comment over 1000 characters", async () => {
      await expectRejected({ bookingId: booking.id, rating: 5, comment: "a".repeat(1001) }, /comment/);
    });
  });
});
