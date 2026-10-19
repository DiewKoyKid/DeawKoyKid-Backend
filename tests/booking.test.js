require("dotenv").config();
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");
const { changeBookingStatus } = require("../src/services/booking.service");
const { expireUnansweredBooking } = require("../src/services/bookingExpiry.service");

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
        bookingStatus: "WAITING_FOR_CONFIRMATION",
      });
      const stored = await prisma.booking.findUnique({ where: { id: res.body.booking.id } });
      expect(stored.bookingStatus).toBe("WAITING_FOR_CONFIRMATION");
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
      await prisma.booking.update({ where: { id: created.body.booking.id }, data: { bookingStatus: "CONFIRMED" } });

      expect((await book(second.agent, service.id, date)).status).toBe(409);
    });

    it("frees the slot again once the booking is rejected", async () => {
      const { service } = await providerWithService();
      const first = await loginAsCustomer();
      const second = await loginAsCustomer();
      const date = dateFromToday(10);

      const created = await book(first.agent, service.id, date);
      await prisma.booking.update({ where: { id: created.body.booking.id }, data: { bookingStatus: "REJECTED" } });

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
// US6-1 — overlapping and conflicting slots (F44)
// A slot is one service on one appointmentDate; it is held by any booking
// whose status is not in RELEASED_STATUSES.
// ---------------------------------------------------------------------------
describe("POST /api/bookings — overlapping and conflicting slots", () => {
  // Another published service owned by the same provider
  async function anotherServiceOf(providerId) {
    const service = await prisma.service.create({
      data: { providerId, title: "Chinatown night market tour", location: "Bangkok", rate: 500 },
    });
    createdServiceIds.push(service.id);
    return service;
  }

  function countOn(serviceId, date) {
    return prisma.booking.count({
      where: { serviceId, appointmentDate: new Date(`${date}T00:00:00.000Z`) },
    });
  }

  describe("conflicts", () => {
    it("returns 409 when the same customer books the same slot twice", async () => {
      const { service } = await providerWithService();
      const { agent } = await loginAsCustomer();
      const date = dateFromToday(10);

      expect((await book(agent, service.id, date)).status).toBe(201);
      const res = await book(agent, service.id, date);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("This time slot is not available");
      expect(await countOn(service.id, date)).toBe(1);
    });

    it("leaves the existing booking untouched when a conflicting request is refused", async () => {
      const { service } = await providerWithService();
      const first = await loginAsCustomer();
      const second = await loginAsCustomer();
      const date = dateFromToday(10);
      const created = await book(first.agent, service.id, date);

      await book(second.agent, service.id, date);

      const stored = await prisma.booking.findUnique({ where: { id: created.body.booking.id } });
      expect(stored).toMatchObject({
        customerId: first.user.id,
        bookingStatus: "WAITING_FOR_CONFIRMATION",
      });
    });

    it("blocks the slot again once a released slot has been re-booked", async () => {
      const { service } = await providerWithService();
      const [first, second, third] = await Promise.all([1, 2, 3].map(() => loginAsCustomer()));
      const date = dateFromToday(10);

      const created = await book(first.agent, service.id, date);
      await prisma.booking.update({ where: { id: created.body.booking.id }, data: { bookingStatus: "REJECTED" } });
      expect((await book(second.agent, service.id, date)).status).toBe(201);

      expect((await book(third.agent, service.id, date)).status).toBe(409);
      expect(await countOn(service.id, date)).toBe(2); // the rejected one plus the active one
    });

    it("lets only one of a customer's double-submitted requests through", async () => {
      const { service } = await providerWithService();
      const { agent } = await loginAsCustomer();
      const date = dateFromToday(12);

      const responses = await Promise.all([book(agent, service.id, date), book(agent, service.id, date)]);

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await countOn(service.id, date)).toBe(1);
    });
  });

  describe("released slots", () => {
    it.each(["REJECTED", "EXPIRED", "CANCELLED"])(
      "frees the slot when the existing booking is %s",
      async (bookingStatus) => {
        const { service } = await providerWithService();
        const first = await loginAsCustomer();
        const second = await loginAsCustomer();
        const date = dateFromToday(10);

        const created = await book(first.agent, service.id, date);
        await prisma.booking.update({ where: { id: created.body.booking.id }, data: { bookingStatus } });

        expect((await book(second.agent, service.id, date)).status).toBe(201);
      }
    );
  });

  describe("no false conflicts", () => {
    it("allows the days immediately before and after a booked date", async () => {
      const { service } = await providerWithService();
      const [first, before, after] = await Promise.all([1, 2, 3].map(() => loginAsCustomer()));

      expect((await book(first.agent, service.id, dateFromToday(10))).status).toBe(201);
      expect((await book(before.agent, service.id, dateFromToday(9))).status).toBe(201);
      expect((await book(after.agent, service.id, dateFromToday(11))).status).toBe(201);
    });

    it("allows the same date on services of different providers", async () => {
      const { service: serviceA } = await providerWithService();
      const { service: serviceB } = await providerWithService();
      const first = await loginAsCustomer();
      const second = await loginAsCustomer();
      const date = dateFromToday(10);

      expect((await book(first.agent, serviceA.id, date)).status).toBe(201);
      expect((await book(second.agent, serviceB.id, date)).status).toBe(201);
    });

    it("lets simultaneous requests for different dates of one service all through", async () => {
      const { service } = await providerWithService();
      const customers = await Promise.all([1, 2, 3, 4].map(() => loginAsCustomer()));

      const responses = await Promise.all(
        customers.map(({ agent }, i) => book(agent, service.id, dateFromToday(20 + i)))
      );

      expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    });
  });

  // Not decided yet: today a slot is per service, so these currently get 201.
  // Un-skip whichever the team agrees on, together with the controller change.
  describe("pending a decision on cross-service conflicts", () => {
    it.skip("returns 409 when the provider is already booked that date on another of their services", async () => {
      const { user: provider, service } = await providerWithService();
      const other = await anotherServiceOf(provider.id);
      const first = await loginAsCustomer();
      const second = await loginAsCustomer();
      const date = dateFromToday(10);

      expect((await book(first.agent, service.id, date)).status).toBe(201);
      expect((await book(second.agent, other.id, date)).status).toBe(409);
    });

    it.skip("returns 409 when the customer already has a booking with another provider that date", async () => {
      const { service: serviceA } = await providerWithService();
      const { service: serviceB } = await providerWithService();
      const { agent } = await loginAsCustomer();
      const date = dateFromToday(10);

      expect((await book(agent, serviceA.id, date)).status).toBe(201);
      expect((await book(agent, serviceB.id, date)).status).toBe(409);
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
// US6-3 — status-change hook (F52)
// changeBookingStatus is what F47's PATCH endpoint and F48's expiry call.
// ---------------------------------------------------------------------------
describe("booking status-change hook (F52)", () => {
  // A booking waiting for confirmation, with the provider's NEW_BOOKING_REQUEST
  // notification already in place
  async function waitingBooking() {
    const provider = await providerWithService();
    const customer = await loginAsCustomer();
    const res = await book(customer.agent, provider.service.id);
    return { provider: provider.user, service: provider.service, customer: customer.user, bookingId: res.body.booking.id };
  }

  function statusNotificationsFor(userId) {
    return prisma.notification.findMany({ where: { userId, type: { startsWith: "BOOKING_" } } });
  }

  it.each([
    ["CONFIRMED", "BOOKING_CONFIRMED", "was confirmed"],
    ["REJECTED", "BOOKING_REJECTED", "was rejected"],
  ])("tells the customer when the provider changes the booking to %s", async (status, type, wording) => {
    const { provider, service, customer, bookingId } = await waitingBooking();

    const result = await changeBookingStatus(bookingId, status, { actorId: provider.id });

    expect(result.booking.bookingStatus).toBe(status);
    const stored = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(stored.bookingStatus).toBe(status);

    const notifications = await statusNotificationsFor(customer.id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ bookingId, type, isRead: false });
    expect(notifications[0].message).toContain(service.title);
    expect(notifications[0].message).toContain(wording);
    expect(await statusNotificationsFor(provider.id)).toHaveLength(0);
  });

  it("tells the provider, not the customer, when the customer cancels", async () => {
    const { provider, customer, bookingId } = await waitingBooking();

    await changeBookingStatus(bookingId, "CANCELLED", { actorId: customer.id });

    expect(await statusNotificationsFor(customer.id)).toHaveLength(0);
    const notifications = await statusNotificationsFor(provider.id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ bookingId, type: "BOOKING_CANCELLED" });
  });

  it("tells both sides about a change with no actor, such as expiry", async () => {
    const { provider, customer, bookingId } = await waitingBooking();

    const { notifications } = await changeBookingStatus(bookingId, "EXPIRED");

    expect(notifications.map((n) => n.userId).sort()).toEqual([customer.id, provider.id].sort());
    expect(notifications.every((n) => n.type === "BOOKING_EXPIRED")).toBe(true);
  });

  it("sends nothing when the booking already has that status", async () => {
    const { provider, customer, bookingId } = await waitingBooking();
    await changeBookingStatus(bookingId, "CONFIRMED", { actorId: provider.id });

    const result = await changeBookingStatus(bookingId, "CONFIRMED", { actorId: provider.id });

    expect(result.notifications).toEqual([]);
    expect(await statusNotificationsFor(customer.id)).toHaveLength(1);
  });

  it("notifies only once when the same change arrives twice at the same time", async () => {
    const { provider, customer, bookingId } = await waitingBooking();

    await Promise.all([
      changeBookingStatus(bookingId, "CONFIRMED", { actorId: provider.id }),
      changeBookingStatus(bookingId, "CONFIRMED", { actorId: provider.id }),
    ]);

    expect(await statusNotificationsFor(customer.id)).toHaveLength(1);
  });

  it("rolls the notification back with the status change", async () => {
    const { provider, customer, bookingId } = await waitingBooking();

    await expect(
      prisma.$transaction(async (tx) => {
        await changeBookingStatus(bookingId, "CONFIRMED", { actorId: provider.id, client: tx });
        throw new Error("caller failed after the change");
      })
    ).rejects.toThrow("caller failed after the change");

    const stored = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(stored.bookingStatus).toBe("WAITING_FOR_CONFIRMATION");
    expect(await statusNotificationsFor(customer.id)).toHaveLength(0);
  });

  it("resolves to null for a booking that doesn't exist", async () => {
    expect(await changeBookingStatus("00000000-0000-0000-0000-000000000000", "CONFIRMED")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// US6-2 — accept / reject / expired (F49)
// Provider decisions (F47) and the 24-hour expiry rule (F48).
// ---------------------------------------------------------------------------
describe("PATCH /api/bookings/:id/status (US6-2, F49)", () => {
  async function waitingBooking() {
    const provider = await providerWithService();
    const customer = await loginAsCustomer();
    const res = await book(customer.agent, provider.service.id);
    expect(res.status).toBe(201);
    return { provider, customer, booking: res.body.booking };
  }

  function decide(agent, bookingId, status) {
    return agent.patch(`/api/bookings/${bookingId}/status`).send({ status });
  }

  async function expectUnchanged(bookingId, status = "WAITING_FOR_CONFIRMATION") {
    const stored = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(stored.bookingStatus).toBe(status);
    expect(await prisma.notification.count({ where: { bookingId, type: { startsWith: "BOOKING_" } } })).toBe(0);
  }

  it("requires authentication", async () => {
    const res = await decide(request(app), "missing-booking", "CONFIRMED");
    expect(res.status).toBe(401);
  });

  it.each(["CONFIRMED", "REJECTED"])("lets the service owner set %s and notifies the customer", async (status) => {
    const { provider, customer, booking } = await waitingBooking();

    const res = await decide(provider.agent, booking.id, status);

    expect(res.status).toBe(200);
    expect(res.body.booking).toEqual({ ...booking, bookingStatus: status });
    const stored = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(stored.bookingStatus).toBe(status);
    const notifications = await prisma.notification.findMany({
      where: { bookingId: booking.id, type: { startsWith: "BOOKING_" } },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ userId: customer.user.id, type: `BOOKING_${status}` });
  });

  it("forbids the booking customer, another customer, and another provider", async () => {
    const { provider, customer, booking } = await waitingBooking();
    const otherCustomer = await loginAsCustomer();
    const otherProvider = await providerWithService();

    for (const { agent } of [customer, otherCustomer, otherProvider]) {
      for (const status of ["CONFIRMED", "REJECTED"]) {
        const res = await agent.patch(`/api/bookings/${booking.id}/status`).send({
          status,
          userId: provider.user.id,
          providerId: provider.user.id,
        });
        expect(res.status).toBe(403);
      }
    }
    await expectUnchanged(booking.id);
  });

  it("returns 404 for a missing booking", async () => {
    const { agent } = await providerWithService();
    const res = await decide(agent, "00000000-0000-0000-0000-000000000000", "CONFIRMED");
    expect(res.status).toBe(404);
  });

  it("rejects missing, malformed, and unsupported statuses without side effects", async () => {
    const { provider, booking } = await waitingBooking();
    for (const status of [undefined, null, "", "confirmed", "UNKNOWN", 1, {}, [], "EXPIRED", "CANCELLED", "COMPLETED", "WAITING_FOR_CONFIRMATION"]) {
      expect((await decide(provider.agent, booking.id, status)).status).toBe(400);
    }
    expect((await provider.agent.patch(`/api/bookings/${booking.id}/status`)).status).toBe(400);
    await expectUnchanged(booking.id);
  });

  it.each(["CONFIRMED", "REJECTED", "EXPIRED", "CANCELLED", "COMPLETED"])("does not overwrite a %s booking with another decision", async (status) => {
    const { provider, booking } = await waitingBooking();
    await prisma.booking.update({ where: { id: booking.id }, data: { bookingStatus: status } });

    const res = await decide(provider.agent, booking.id, status === "CONFIRMED" ? "REJECTED" : "CONFIRMED");

    expect(res.status).toBe(409);
    if (status === "EXPIRED") expect(res.body.error).toBe("This request has expired");
    await expectUnchanged(booking.id, status);
  });

  it("handles concurrent retries without duplicate notifications", async () => {
    const { provider, customer, booking } = await waitingBooking();
    const responses = await Promise.all([
      decide(provider.agent, booking.id, "CONFIRMED"),
      decide(provider.agent, booking.id, "CONFIRMED"),
    ]);
    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(await prisma.notification.count({ where: { bookingId: booking.id, userId: customer.user.id } })).toBe(1);
    expect((await decide(customer.agent, booking.id, "CONFIRMED")).status).toBe(403);
  });

  it("allows only one of two concurrent conflicting decisions", async () => {
    const { provider, customer, booking } = await waitingBooking();
    const responses = await Promise.all([
      decide(provider.agent, booking.id, "CONFIRMED"),
      decide(provider.agent, booking.id, "REJECTED"),
    ]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    const winner = responses.find((res) => res.status === 200).body.booking.bookingStatus;
    const stored = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(stored.bookingStatus).toBe(winner);
    const notifications = await prisma.notification.findMany({ where: { bookingId: booking.id, userId: customer.user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe(`BOOKING_${winner}`);
  });

  it.each(["CONFIRMED", "REJECTED"])("expires an overdue request instead of applying %s", async (status) => {
    const { provider, customer, booking } = await waitingBooking();
    await prisma.booking.update({
      where: { id: booking.id }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const res = await decide(provider.agent, booking.id, status);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("This request has expired");
    const stored = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(stored.bookingStatus).toBe("EXPIRED");
    expect((await decide(provider.agent, booking.id, status)).status).toBe(409);
    const notifications = await prisma.notification.findMany({
      where: { bookingId: booking.id, type: { startsWith: "BOOKING_" } },
    });
    expect(notifications).toHaveLength(2);
    expect(notifications.every((n) => n.type === "BOOKING_EXPIRED")).toBe(true);
    expect(notifications.map((n) => n.userId).sort()).toEqual([provider.user.id, customer.user.id].sort());

    // An expired request no longer holds the service's slot.
    expect((await book(customer.agent, provider.service.id, booking.appointmentDate)).status).toBe(201);
  });

  it.each([[1, 200, "CONFIRMED"], [0, 409, "EXPIRED"]])("enforces the boundary with %i ms remaining", async (remaining, statusCode, status) => {
    const { provider, booking } = await waitingBooking();
    const now = Date.now();
    await prisma.booking.update({
      where: { id: booking.id }, data: { createdAt: new Date(now - 24 * 60 * 60 * 1000 + remaining) },
    });
    const clock = jest.spyOn(Date, "now").mockReturnValue(now);
    try {
      expect((await decide(provider.agent, booking.id, "CONFIRMED")).status).toBe(statusCode);
      expect((await prisma.booking.findUnique({ where: { id: booking.id } })).bookingStatus).toBe(status);
    } finally {
      clock.mockRestore();
    }
  });

  it("expires without a provider action and does not duplicate a concurrent expiry", async () => {
    const { provider, booking } = await waitingBooking();
    await prisma.booking.update({
      where: { id: booking.id }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    await Promise.all([expireUnansweredBooking(booking.id), expireUnansweredBooking(booking.id)]);
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).bookingStatus).toBe("EXPIRED");
    expect(await prisma.notification.count({ where: { bookingId: booking.id, type: "BOOKING_EXPIRED" } })).toBe(2);
    expect((await decide(provider.agent, booking.id, "CONFIRMED")).status).toBe(409);
  });

  it("serializes expiry with an overdue provider decision", async () => {
    const { provider, booking } = await waitingBooking();
    await prisma.booking.update({
      where: { id: booking.id }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    const [res] = await Promise.all([
      decide(provider.agent, booking.id, "CONFIRMED"), expireUnansweredBooking(booking.id),
    ]);
    expect(res.status).toBe(409);
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).bookingStatus).toBe("EXPIRED");
    expect(await prisma.notification.count({ where: { bookingId: booking.id, type: "BOOKING_EXPIRED" } })).toBe(2);
    expect(await prisma.notification.count({ where: { bookingId: booking.id, type: "BOOKING_CONFIRMED" } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// US6-3 — email turned off means in-app only (F54)
// The status-change hook (F52) is in; waiting on Max's email sending with the
// user's email setting (F53).
// ---------------------------------------------------------------------------
describe("booking status notifications (US6-3, F54)", () => {
  it.todo("a user with email notifications off gets only an in-app notification when their booking status changes, and no email is sent");
  it.todo("a user with email notifications on gets both an in-app notification and an email");
});
