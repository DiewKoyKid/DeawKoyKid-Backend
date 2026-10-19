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
  // Bookings and services don't cascade from users, so remove them first.
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

async function providerWithService(title = "Old Town street food walk") {
  const agent = request.agent(app);
  const user = await registerAndLogin(agent, { ...uniqueUser("br_provider"), idCard: "1234567890123" }, "/api/auth/register/provider");
  const service = await prisma.service.create({
    data: { providerId: user.id, title, location: "Bangkok", rate: 450, rateUnit: "hour" },
  });
  createdServiceIds.push(service.id);
  return { agent, user, service };
}

async function customer(firstname = "Nina") {
  const payload = { ...uniqueUser("br_customer"), firstname, lastname: "P." };
  return registerAndLogin(request.agent(app), payload);
}

function bookingFor(serviceId, customerId, overrides = {}) {
  return prisma.booking.create({
    data: {
      serviceId,
      customerId,
      bookingDate: new Date("2026-10-16T00:00:00.000Z"),
      appointmentDate: new Date("2030-06-01T00:00:00.000Z"),
      startTime: "09:00",
      endTime: "12:00",
      totalPrice: 1350,
      ...overrides,
    },
  });
}

const url = "/api/providers/me/booking-requests";

describe("GET /api/providers/me/booking-requests (US6-2)", () => {
  describe("access", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });

    it("rejects an account without a provider profile", async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, uniqueUser("br_not_provider"));

      const res = await agent.get(url);

      expect(res.status).toBe(403);
    });
  });

  it("returns an empty list when the provider has no requests", async () => {
    const { agent } = await providerWithService();

    const res = await agent.get(url);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bookingRequests: [] });
  });

  it("lists a request with its service, customer, time and deadline", async () => {
    const { agent, service } = await providerWithService();
    const nina = await customer("Nina");
    const booking = await bookingFor(service.id, nina.id);

    const res = await agent.get(url);

    expect(res.status).toBe(200);
    expect(res.body.bookingRequests).toEqual([
      {
        id: booking.id,
        bookingStatus: "WAITING_FOR_CONFIRMATION",
        appointmentDate: "2030-06-01",
        startTime: "09:00",
        endTime: "12:00",
        totalPrice: 1350,
        createdAt: booking.createdAt.toISOString(),
        respondBy: new Date(booking.createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        service: { id: service.id, title: service.title, location: "Bangkok" },
        customer: { firstname: "Nina", lastname: "P.", profilePhotoUrl: null },
      },
    ]);
  });

  it("has no respondBy once the request is answered", async () => {
    const { agent, service } = await providerWithService();
    const nina = await customer();
    await bookingFor(service.id, nina.id, { bookingStatus: "CONFIRMED" });

    const res = await agent.get(url);

    expect(res.body.bookingRequests[0]).toMatchObject({ bookingStatus: "CONFIRMED", respondBy: null });
  });

  it("only lists bookings for the provider's own services", async () => {
    const mine = await providerWithService("My tour");
    const other = await providerWithService("Someone else's tour");
    const nina = await customer();
    const myBooking = await bookingFor(mine.service.id, nina.id);
    await bookingFor(other.service.id, nina.id);

    const res = await mine.agent.get(url);

    expect(res.body.bookingRequests.map((b) => b.id)).toEqual([myBooking.id]);
  });

  it("covers every one of the provider's services, newest request first", async () => {
    const { agent, user, service } = await providerWithService("First tour");
    const second = await prisma.service.create({
      data: { providerId: user.id, title: "Second tour", location: "Bangkok", rate: 500 },
    });
    createdServiceIds.push(second.id);
    const nina = await customer();
    const older = await bookingFor(service.id, nina.id, { createdAt: new Date(Date.now() - 60 * 60 * 1000) });
    const newer = await bookingFor(second.id, nina.id);

    const res = await agent.get(url);

    expect(res.body.bookingRequests.map((b) => b.id)).toEqual([newer.id, older.id]);
  });

  describe("status filter", () => {
    it("returns only the requested statuses", async () => {
      const { agent, service } = await providerWithService();
      const nina = await customer();
      const waiting = await bookingFor(service.id, nina.id);
      const confirmed = await bookingFor(service.id, nina.id, { bookingStatus: "CONFIRMED", appointmentDate: new Date("2030-06-02T00:00:00.000Z") });
      await bookingFor(service.id, nina.id, { bookingStatus: "REJECTED", appointmentDate: new Date("2030-06-03T00:00:00.000Z") });

      const onlyWaiting = await agent.get(url).query({ status: "WAITING_FOR_CONFIRMATION" });
      const waitingOrConfirmed = await agent.get(url).query({ status: "WAITING_FOR_CONFIRMATION,CONFIRMED" });

      expect(onlyWaiting.body.bookingRequests.map((b) => b.id)).toEqual([waiting.id]);
      expect(waitingOrConfirmed.body.bookingRequests.map((b) => b.id).sort()).toEqual([waiting.id, confirmed.id].sort());
    });

    it("returns 400 for an unknown status", async () => {
      const { agent } = await providerWithService();

      const res = await agent.get(url).query({ status: "PENDING" });

      expect(res.status).toBe(400);
    });
  });
});
