require("dotenv").config();
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");

// US4-3: publish / unpublish a service (PATCH /api/services/:id/status).
// Unpublishing is refused while a booking request is still pending.

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

async function loginAsProvider(prefix = "unpub_provider") {
  const agent = request.agent(app);
  const user = await registerAndLogin(
    agent,
    { ...uniqueUser(prefix), idCard: "1234567890123" },
    "/api/auth/register/provider",
  );
  return { agent, user };
}

async function createCustomer() {
  const agent = request.agent(app);
  return registerAndLogin(agent, uniqueUser("unpub_customer"));
}

async function createService(providerId, overrides = {}) {
  const service = await prisma.service.create({
    data: {
      providerId,
      title: "Old Town street food walk",
      location: "Bangkok",
      rate: 500,
      rateUnit: "hour",
      startTime: "09:00",
      endTime: "17:00",
      ...overrides,
    },
  });
  createdServiceIds.push(service.id);
  return service;
}

function dateFromToday(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addBooking(serviceId, customerId, overrides = {}) {
  return prisma.booking.create({
    data: {
      serviceId,
      customerId,
      bookingDate: new Date(dateFromToday(0)),
      appointmentDate: new Date(dateFromToday(8)),
      startTime: "09:00",
      endTime: "12:00",
      totalPrice: 1500,
      bookingStatus: "WAITING_FOR_CONFIRMATION",
      ...overrides,
    },
  });
}

async function isPublished(serviceId) {
  const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { isPublished: true } });
  return service.isPublished;
}

describe("PATCH /api/services/:id/status (US4-3)", () => {
  describe("access and validation", () => {
    it("rejects an unauthenticated request", async () => {
      const { user } = await loginAsProvider();
      const service = await createService(user.id);

      const res = await request(app).patch(`/api/services/${service.id}/status`).send({ status: "UNPUBLISHED" });

      expect(res.status).toBe(401);
    });

    it("returns 404 for a service that doesn't exist", async () => {
      const { agent } = await loginAsProvider();

      const res = await agent
        .patch("/api/services/00000000-0000-0000-0000-000000000000/status")
        .send({ status: "UNPUBLISHED" });

      expect(res.status).toBe(404);
    });

    it("rejects another provider's service and leaves it published", async () => {
      const { user: owner } = await loginAsProvider("unpub_owner");
      const { agent: other } = await loginAsProvider("unpub_other");
      const service = await createService(owner.id);

      const res = await other.patch(`/api/services/${service.id}/status`).send({ status: "UNPUBLISHED" });

      expect(res.status).toBe(403);
      expect(await isPublished(service.id)).toBe(true);
    });

    it("returns 400 for an unknown status", async () => {
      const { agent, user } = await loginAsProvider();
      const service = await createService(user.id);

      const res = await agent.patch(`/api/services/${service.id}/status`).send({ status: "HIDDEN" });

      expect(res.status).toBe(400);
      expect(await isPublished(service.id)).toBe(true);
    });
  });

  describe("unpublishing", () => {
    it("unpublishes a service with no pending requests and keeps its confirmed bookings", async () => {
      const { agent, user } = await loginAsProvider();
      const service = await createService(user.id);
      const customer = await createCustomer();
      const confirmed = await addBooking(service.id, customer.id, { bookingStatus: "CONFIRMED" });

      const res = await agent.patch(`/api/services/${service.id}/status`).send({ status: "UNPUBLISHED" });

      expect(res.status).toBe(200);
      expect(res.body.service).toEqual({ id: service.id, status: "UNPUBLISHED" });
      expect(await isPublished(service.id)).toBe(false);
      const stillConfirmed = await prisma.booking.findUnique({ where: { id: confirmed.id } });
      expect(stillConfirmed.bookingStatus).toBe("CONFIRMED");
    });

    it("hides an unpublished service from its public page", async () => {
      const { agent, user } = await loginAsProvider();
      const service = await createService(user.id);

      await agent.patch(`/api/services/${service.id}/status`).send({ status: "UNPUBLISHED" });
      const res = await request(app).get(`/api/services/${service.id}`);

      expect(res.status).toBe(410);
    });

    // Acceptance criterion 2
    it("refuses with 409 while a request is pending, and the service stays published", async () => {
      const { agent, user } = await loginAsProvider();
      const service = await createService(user.id);
      const customer = await createCustomer();
      const pending = await addBooking(service.id, customer.id);

      const res = await agent.patch(`/api/services/${service.id}/status`).send({ status: "UNPUBLISHED" });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Please respond to pending requests first");
      expect(res.body.pendingRequests).toEqual([
        {
          id: pending.id,
          appointmentDate: dateFromToday(8),
          startTime: "09:00",
          endTime: "12:00",
          customerName: "Test U.",
        },
      ]);
      expect(await isPublished(service.id)).toBe(true);
    });

    it("allows unpublishing once the pending request has been answered", async () => {
      const { agent, user } = await loginAsProvider();
      const service = await createService(user.id);
      const customer = await createCustomer();
      const pending = await addBooking(service.id, customer.id);

      expect((await agent.patch(`/api/services/${service.id}/status`).send({ status: "UNPUBLISHED" })).status).toBe(409);
      await prisma.booking.update({ where: { id: pending.id }, data: { bookingStatus: "REJECTED" } });

      const res = await agent.patch(`/api/services/${service.id}/status`).send({ status: "UNPUBLISHED" });

      expect(res.status).toBe(200);
      expect(await isPublished(service.id)).toBe(false);
    });

    it("ignores a request older than the 24-hour response window", async () => {
      const { agent, user } = await loginAsProvider();
      const service = await createService(user.id);
      const customer = await createCustomer();
      await addBooking(service.id, customer.id, { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });

      const res = await agent.patch(`/api/services/${service.id}/status`).send({ status: "UNPUBLISHED" });

      expect(res.status).toBe(200);
    });
  });

  it("publishes an unpublished service again", async () => {
    const { agent, user } = await loginAsProvider();
    const service = await createService(user.id, { isPublished: false });

    const res = await agent.patch(`/api/services/${service.id}/status`).send({ status: "PUBLISHED" });

    expect(res.status).toBe(200);
    expect(res.body.service.status).toBe("PUBLISHED");
    expect(await isPublished(service.id)).toBe(true);
  });
});
