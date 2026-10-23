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

async function loginAsCustomer() {
  const agent = request.agent(app);
  const user = await registerAndLogin(agent, uniqueUser("mb_customer"));
  return { agent, user };
}

async function providerWithService() {
  const agent = request.agent(app);
  const payload = { ...uniqueUser("mb_provider"), firstname: "Mali", idCard: "1234567890123" };
  const user = await registerAndLogin(agent, payload, "/api/auth/register/provider");
  const service = await prisma.service.create({
    data: { providerId: user.id, title: "Old Town street food walk", location: "Bangkok", rate: 450 },
  });
  createdServiceIds.push(service.id);
  return { agent, user, service };
}

// Local calendar date `offset` days from today, at UTC midnight like @db.Date
function dayFromToday(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function bookingFor(serviceId, customerId, overrides = {}) {
  return prisma.booking.create({
    data: {
      serviceId,
      customerId,
      bookingDate: dayFromToday(-10),
      appointmentDate: dayFromToday(7),
      bookingStatus: "CONFIRMED",
      totalPrice: 450,
      ...overrides,
    },
  });
}

describe("GET /api/bookings/me (US6-4)", () => {
  it("requires authentication", async () => {
    expect((await request(app).get("/api/bookings/me")).status).toBe(401);
  });

  it("returns empty lists for a customer without bookings", async () => {
    const { agent } = await loginAsCustomer();
    const res = await agent.get("/api/bookings/me");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ upcoming: [], past: [] });
  });

  it("splits the customer's bookings into upcoming and past", async () => {
    const { user: provider, service } = await providerWithService();
    const { agent, user } = await loginAsCustomer();
    const later = await bookingFor(service.id, user.id, { appointmentDate: dayFromToday(14) });
    const soon = await bookingFor(service.id, user.id, { appointmentDate: dayFromToday(3), bookingStatus: "WAITING_FOR_CONFIRMATION" });
    const started = await bookingFor(service.id, user.id, { appointmentDate: dayFromToday(-1) });
    const cancelled = await bookingFor(service.id, user.id, { appointmentDate: dayFromToday(5), bookingStatus: "CANCELLED" });
    const completed = await bookingFor(service.id, user.id, { appointmentDate: dayFromToday(-30), bookingStatus: "COMPLETED" });
    // Someone else's booking stays out
    const other = await loginAsCustomer();
    await bookingFor(service.id, other.user.id, { appointmentDate: dayFromToday(20) });

    const res = await agent.get("/api/bookings/me");

    expect(res.status).toBe(200);
    expect(res.body.upcoming.map((b) => b.id)).toEqual([soon.id, later.id]);
    expect(res.body.past.map((b) => b.id)).toEqual([cancelled.id, started.id, completed.id]);
    expect(res.body.upcoming[1]).toMatchObject({
      bookingStatus: "CONFIRMED",
      appointmentDate: later.appointmentDate.toISOString().slice(0, 10),
      totalPrice: 450,
      canCancel: true,
      service: { id: service.id, title: service.title, location: "Bangkok" },
      provider: { id: provider.id, firstname: "Mali" },
    });
    expect(res.body.upcoming[0].canCancel).toBe(false); // still waiting for the provider
    expect(res.body.past.every((b) => b.canCancel === false)).toBe(true);
  });
});

describe("PATCH /api/bookings/:id/cancel (US6-4)", () => {
  function cancel(agent, bookingId) {
    return agent.patch(`/api/bookings/${bookingId}/cancel`);
  }

  it("cancels a confirmed booking, notifies the provider, and frees the slot", async () => {
    const { user: provider, service } = await providerWithService();
    const { agent, user } = await loginAsCustomer();
    const booking = await bookingFor(service.id, user.id);

    const res = await cancel(agent, booking.id);

    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ id: booking.id, bookingStatus: "CANCELLED" });
    const stored = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(stored.bookingStatus).toBe("CANCELLED");
    const notifications = await prisma.notification.findMany({ where: { bookingId: booking.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ userId: provider.id, type: "BOOKING_CANCELLED" });

    const other = await loginAsCustomer();
    const rebooked = await other.agent.post("/api/bookings").send({
      serviceId: service.id,
      appointmentDate: booking.appointmentDate.toISOString().slice(0, 10),
    });
    expect(rebooked.status).toBe(201);

    // Retrying doesn't notify again
    expect((await cancel(agent, booking.id)).status).toBe(200);
    expect(await prisma.notification.count({ where: { bookingId: booking.id } })).toBe(1);
  });

  it("refuses a booking that has already started", async () => {
    const { service } = await providerWithService();
    const { agent, user } = await loginAsCustomer();
    const booking = await bookingFor(service.id, user.id, { appointmentDate: dayFromToday(0) });

    const res = await cancel(agent, booking.id);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("This booking has already started and can no longer be cancelled.");
    const stored = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(stored.bookingStatus).toBe("CONFIRMED");
    expect(await prisma.notification.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it.each(["WAITING_FOR_CONFIRMATION", "REJECTED", "EXPIRED", "COMPLETED"])("refuses a %s booking", async (status) => {
    const { service } = await providerWithService();
    const { agent, user } = await loginAsCustomer();
    const booking = await bookingFor(service.id, user.id, { bookingStatus: status });

    expect((await cancel(agent, booking.id)).status).toBe(409);
    const stored = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(stored.bookingStatus).toBe(status);
  });

  it("forbids the provider and other customers", async () => {
    const provider = await providerWithService();
    const { user } = await loginAsCustomer();
    const other = await loginAsCustomer();
    const booking = await bookingFor(provider.service.id, user.id);

    expect((await cancel(provider.agent, booking.id)).status).toBe(403);
    expect((await cancel(other.agent, booking.id)).status).toBe(403);
    const stored = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(stored.bookingStatus).toBe("CONFIRMED");
  });

  it("returns 404 for a missing booking", async () => {
    const { agent } = await loginAsCustomer();
    expect((await cancel(agent, "00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });
});
