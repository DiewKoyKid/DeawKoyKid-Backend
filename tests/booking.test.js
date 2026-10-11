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
  // Notifications cascade from both bookings and users.
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

async function loginAsCustomer(prefix = "bk_customer") {
  const agent = request.agent(app);
  const user = await registerAndLogin(agent, uniqueUser(prefix));
  return { agent, user };
}

// A provider with one published service, plus a logged-in agent for them
async function providerWithService() {
  const agent = request.agent(app);
  const payload = { ...uniqueUser("bk_provider"), idCard: "1234567890123" };
  const user = await registerAndLogin(agent, payload, "/api/auth/register/provider");
  const service = await prisma.service.create({
    data: { providerId: user.id, title: "Old Town street food walk", location: "Bangkok", rate: 450 },
  });
  createdServiceIds.push(service.id);
  return { agent, user, service };
}

// Local calendar date `offset` days from today as YYYY-MM-DD (matches the
// controller, which takes "today" in the server's timezone)
function dateFromToday(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function book(agent, serviceId, appointmentDate = dateFromToday(7)) {
  return agent.post("/api/bookings").send({ serviceId, appointmentDate });
}

// ---------------------------------------------------------------------------
// US6-1 — create a booking (F42 slot taken / past date, F44 tests)
// ---------------------------------------------------------------------------
describe("POST /api/bookings (US6-1)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post("/api/bookings").send({});
    expect(res.status).toBe(401);
  });

  describe("valid slot", () => {
    it("creates a booking waiting for the provider's confirmation", async () => {
      const { service } = await providerWithService();
      const { agent, user } = await loginAsCustomer();
      const appointmentDate = dateFromToday(7);

      const res = await book(agent, service.id, appointmentDate);

      expect(res.status).toBe(201);
      expect(res.body.booking).toMatchObject({
        serviceId: service.id,
        customerId: user.id,
        appointmentDate,
        bookingDate: dateFromToday(0),
        bookingStatus: "Waiting for confirmation",
      });
      const stored = await prisma.booking.findUnique({ where: { id: res.body.booking.id } });
      expect(stored.bookingStatus).toBe("Waiting for confirmation");
    });

    it("accepts today's date", async () => {
      const { service } = await providerWithService();
      const { agent } = await loginAsCustomer();

      const res = await book(agent, service.id, dateFromToday(0));

      expect(res.status).toBe(201);
    });

    it("lets another customer book the same service on a different date", async () => {
      const { service } = await providerWithService();
      const first = await loginAsCustomer();
      const second = await loginAsCustomer();

      expect((await book(first.agent, service.id, dateFromToday(7))).status).toBe(201);
      expect((await book(second.agent, service.id, dateFromToday(8))).status).toBe(201);
    });
  });

  describe("slot taken", () => {
    it("returns 409 when the date is already booked for the service", async () => {
      const { service } = await providerWithService();
      const first = await loginAsCustomer();
      const second = await loginAsCustomer();
      const date = dateFromToday(10);

      await book(first.agent, service.id, date);
      const res = await book(second.agent, service.id, date);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("This time slot is not available");
      expect(await prisma.booking.count({ where: { serviceId: service.id } })).toBe(1);
    });

    it("still counts a confirmed booking as taken", async () => {
      const { service } = await providerWithService();
      const first = await loginAsCustomer();
      const second = await loginAsCustomer();
      const date = dateFromToday(10);

      const created = await book(first.agent, service.id, date);
      await prisma.booking.update({ where: { id: created.body.booking.id }, data: { bookingStatus: "Confirmed" } });

      expect((await book(second.agent, service.id, date)).status).toBe(409);
    });

    it("frees the slot again once the booking is rejected", async () => {
      const { service } = await providerWithService();
      const first = await loginAsCustomer();
      const second = await loginAsCustomer();
      const date = dateFromToday(10);

      const created = await book(first.agent, service.id, date);
      await prisma.booking.update({ where: { id: created.body.booking.id }, data: { bookingStatus: "Rejected" } });

      expect((await book(second.agent, service.id, date)).status).toBe(201);
    });

    it("lets only one of several simultaneous requests for the same slot through", async () => {
      const { service } = await providerWithService();
      const customers = await Promise.all([1, 2, 3, 4, 5].map(() => loginAsCustomer()));
      const date = dateFromToday(12);

      const responses = await Promise.all(customers.map(({ agent }) => book(agent, service.id, date)));
      const statuses = responses.map((r) => r.status).sort();

      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      expect(await prisma.booking.count({ where: { serviceId: service.id, appointmentDate: new Date(`${date}T00:00:00.000Z`) } })).toBe(1);
      // The rolled-back requests left no notifications behind
      expect(await prisma.notification.count({ where: { userId: service.providerId } })).toBe(1);
    });
  });

  describe("past date", () => {
    it("returns 400 for a date before today and stores nothing", async () => {
      const { service } = await providerWithService();
      const { agent } = await loginAsCustomer();

      const res = await book(agent, service.id, dateFromToday(-1));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("This time slot is not available");
      expect(await prisma.booking.count({ where: { serviceId: service.id } })).toBe(0);
      expect(await prisma.notification.count({ where: { userId: service.providerId } })).toBe(0);
    });

    it("returns 400 for a date long in the past", async () => {
      const { service } = await providerWithService();
      const { agent } = await loginAsCustomer();

      const res = await book(agent, service.id, "2020-01-01");

      expect(res.status).toBe(400);
    });
  });
});

// ---------------------------------------------------------------------------
// US6-1 — notify the provider of a new request (F43)
// ---------------------------------------------------------------------------
describe("provider notification on a new booking (US6-1, F43)", () => {
  it("creates an in-app notification for the service's provider", async () => {
    const { user, service } = await providerWithService();
    const { agent } = await loginAsCustomer();

    const res = await book(agent, service.id);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      bookingId: res.body.booking.id,
      type: "NEW_BOOKING_REQUEST",
      isRead: false,
    });
    expect(notifications[0].message).toContain(service.title);
  });

  it("does not notify the provider when the slot was already taken", async () => {
    const { user, service } = await providerWithService();
    const first = await loginAsCustomer();
    const second = await loginAsCustomer();
    await book(first.agent, service.id);

    const res = await book(second.agent, service.id);

    expect(res.status).toBe(409);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
  });

  it("does not notify the customer who made the request", async () => {
    const { service } = await providerWithService();
    const { agent, user } = await loginAsCustomer();

    await book(agent, service.id);

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// US6-2 — accept / reject / expired (F49)
// Waiting on Alex: PATCH /api/bookings/:id/status (F47) and the 24-hour
// expiry rule (F48). Fill these in against that API once it is merged.
// ---------------------------------------------------------------------------
describe("PATCH /api/bookings/:id/status (US6-2, F49)", () => {
  it.todo("accept: the provider accepts within 24 hours and the status becomes \"Confirmed\"");
  it.todo("reject: the provider rejects a waiting request and the status becomes \"Rejected\"");
  it.todo("expired: accepting a request unanswered for over 24 hours shows \"This request has expired\" and the status stays \"Expired\"");
  it.todo("a request just under 24 hours old can still be accepted");
  it.todo("only the service's provider can change the status (403 for anyone else)");
});

// ---------------------------------------------------------------------------
// US6-3 — email turned off means in-app only (F54)
// Waiting on Den's status-change hook (F52) and Max's email sending with the
// user's email setting (F53).
// ---------------------------------------------------------------------------
describe("booking status notifications (US6-3, F54)", () => {
  it.todo("a user with email notifications off gets only an in-app notification when their booking status changes, and no email is sent");
  it.todo("a user with email notifications on gets both an in-app notification and an email");
});
