require("dotenv").config();
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");

// US4-3: edit a service (PUT /api/services/:id) and read it for the edit page
// (GET /api/providers/me/services/:id).

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

async function loginAsProvider(prefix = "edit_provider") {
  const agent = request.agent(app);
  const user = await registerAndLogin(
    agent,
    { ...uniqueUser(prefix), idCard: "1234567890123" },
    "/api/auth/register/provider",
  );
  return { agent, user };
}

async function loginAsCustomer(prefix = "edit_customer") {
  const agent = request.agent(app);
  const user = await registerAndLogin(agent, uniqueUser(prefix));
  return { agent, user };
}

// Priced per day, so a booking without a time slot gets totalPrice = rate.
async function createService(providerId, overrides = {}) {
  const service = await prisma.service.create({
    data: {
      providerId,
      title: "Old Town street food walk",
      location: "Bangkok – Yaowarat & Old Town",
      rate: 500,
      rateUnit: "day",
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

const editBody = (overrides = {}) => ({
  title: "Old Town street food walk",
  description: "We'll eat our way down Yaowarat Road.",
  location: "Bangkok – Yaowarat & Old Town",
  rate: 600,
  rateUnit: "day",
  startTime: "09:00",
  endTime: "17:00",
  ...overrides,
});

describe("PUT /api/services/:id (US4-3)", () => {
  describe("access", () => {
    it("rejects an unauthenticated request", async () => {
      const { user } = await loginAsProvider();
      const service = await createService(user.id);

      const res = await request(app).put(`/api/services/${service.id}`).send(editBody());

      expect(res.status).toBe(401);
    });

    it("returns 404 for a service that doesn't exist", async () => {
      const { agent } = await loginAsProvider();

      const res = await agent.put("/api/services/00000000-0000-0000-0000-000000000000").send(editBody());

      expect(res.status).toBe(404);
    });

    it("rejects another provider's service and leaves it unchanged", async () => {
      const { user: owner } = await loginAsProvider("edit_owner");
      const { agent: other } = await loginAsProvider("edit_other");
      const service = await createService(owner.id);

      const res = await other.put(`/api/services/${service.id}`).send(editBody());

      expect(res.status).toBe(403);
      const stored = await prisma.service.findUnique({ where: { id: service.id } });
      expect(Number(stored.rate)).toBe(500);
    });
  });

  describe("editing", () => {
    it("saves the new values and returns 200", async () => {
      const { agent, user } = await loginAsProvider();
      const service = await createService(user.id);

      const res = await agent
        .put(`/api/services/${service.id}`)
        .send(editBody({ title: "  Night market walk  ", rate: 600 }));

      expect(res.status).toBe(200);
      expect(res.body.service).toMatchObject({
        id: service.id,
        title: "Night market walk",
        rate: 600,
        rateUnit: "day",
        status: "PUBLISHED",
      });
      const stored = await prisma.service.findUnique({ where: { id: service.id } });
      expect(stored.title).toBe("Night market walk");
      expect(Number(stored.rate)).toBe(600);
    });

    it("does not change whether the service is published", async () => {
      const { agent, user } = await loginAsProvider();
      const service = await createService(user.id, { isPublished: false });

      const res = await agent.put(`/api/services/${service.id}`).send(editBody());

      expect(res.status).toBe(200);
      expect(res.body.service.status).toBe("UNPUBLISHED");
    });

    it("keeps the cover photo when coverPhotoUrl is left out, and removes it when null", async () => {
      const { agent, user } = await loginAsProvider();
      const service = await createService(user.id, { coverPhotoUrl: "/uploads/cover.jpg" });

      const kept = await agent.put(`/api/services/${service.id}`).send(editBody());
      expect(kept.body.service.coverPhotoUrl).toBe("/uploads/cover.jpg");

      const removed = await agent.put(`/api/services/${service.id}`).send(editBody({ coverPhotoUrl: null }));
      expect(removed.body.service.coverPhotoUrl).toBeNull();
    });

    it("returns 400 with a per-field error for an invalid rate and saves nothing", async () => {
      const { agent, user } = await loginAsProvider();
      const service = await createService(user.id);

      const res = await agent.put(`/api/services/${service.id}`).send(editBody({ rate: 0 }));

      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveProperty("rate");
      const stored = await prisma.service.findUnique({ where: { id: service.id } });
      expect(Number(stored.rate)).toBe(500);
    });
  });

  // Acceptance criterion 1: the new rate applies to bookings made afterwards,
  // while existing confirmed bookings keep the previously agreed rate.
  it("applies a new rate to later bookings only; a confirmed booking keeps its price", async () => {
    const { agent: provider, user } = await loginAsProvider();
    const service = await createService(user.id, { rate: 500 });

    const first = await loginAsCustomer();
    const before = await first.agent.post("/api/bookings").send({ serviceId: service.id, appointmentDate: dateFromToday(7) });
    expect(before.status).toBe(201);
    await prisma.booking.update({ where: { id: before.body.booking.id }, data: { bookingStatus: "CONFIRMED" } });

    const edit = await provider.put(`/api/services/${service.id}`).send(editBody({ rate: 600 }));
    expect(edit.status).toBe(200);

    const confirmed = await prisma.booking.findUnique({ where: { id: before.body.booking.id } });
    expect(Number(confirmed.totalPrice)).toBe(500);

    const second = await loginAsCustomer();
    const after = await second.agent.post("/api/bookings").send({ serviceId: service.id, appointmentDate: dateFromToday(8) });
    expect(after.status).toBe(201);
    const newBooking = await prisma.booking.findUnique({ where: { id: after.body.booking.id } });
    expect(Number(newBooking.totalPrice)).toBe(600);
  });
});

describe("GET /api/providers/me/services/:id (US4-3)", () => {
  it("returns the service with its status, categories and booking counts", async () => {
    const { agent, user } = await loginAsProvider();
    const service = await createService(user.id, { isPublished: false });
    const { user: customer } = await loginAsCustomer();
    const base = { serviceId: service.id, customerId: customer.id, bookingDate: new Date(), totalPrice: 500 };
    await prisma.booking.createMany({
      data: [
        { ...base, appointmentDate: new Date(dateFromToday(5)), bookingStatus: "WAITING_FOR_CONFIRMATION" },
        { ...base, appointmentDate: new Date(dateFromToday(6)), bookingStatus: "CONFIRMED" },
        { ...base, appointmentDate: new Date(dateFromToday(7)), bookingStatus: "CONFIRMED" },
        { ...base, appointmentDate: new Date(dateFromToday(8)), bookingStatus: "CANCELLED" },
      ],
    });

    const res = await agent.get(`/api/providers/me/services/${service.id}`);

    expect(res.status).toBe(200);
    expect(res.body.service).toMatchObject({
      id: service.id,
      rate: 500,
      rateUnit: "day",
      status: "UNPUBLISHED",
      categoryIds: [],
      pendingRequestCount: 1,
      confirmedBookingCount: 2,
    });
  });

  it("rejects another provider's service", async () => {
    const { user: owner } = await loginAsProvider("get_owner");
    const { agent: other } = await loginAsProvider("get_other");
    const service = await createService(owner.id);

    const res = await other.get(`/api/providers/me/services/${service.id}`);

    expect(res.status).toBe(403);
  });
});
