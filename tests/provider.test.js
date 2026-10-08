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
  // Services and bookings don't cascade from users, so remove them first.
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

async function loginAsNewProvider(agent, prefix) {
  const payload = { ...uniqueUser(prefix), idCard: "1234567890123" };
  return registerAndLogin(agent, payload, "/api/auth/register/provider");
}

// The 15th of a month (UTC), safely inside it whatever the server timezone.
function midMonth(monthOffset) {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + monthOffset, 15));
}

describe("GET /api/providers/me/services", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/providers/me/services");
    expect(res.status).toBe(401);
  });

  it("rejects an account without a provider profile", async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, uniqueUser("my_services_customer"));

    const res = await agent.get("/api/providers/me/services");

    expect(res.status).toBe(403);
  });

  it("returns an empty array for a provider with no services", async () => {
    const agent = request.agent(app);
    await loginAsNewProvider(agent, "my_services_empty");

    const res = await agent.get("/api/providers/me/services");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns each service in the agreed shape with this month's bookings", async () => {
    const agent = request.agent(app);
    const provider = await loginAsNewProvider(agent, "my_services_list");

    const customerPayload = uniqueUser("my_services_booker");
    await request(app).post("/api/auth/register").send(customerPayload);
    const customer = await prisma.user.findUnique({
      where: { username: customerPayload.username },
      select: { id: true },
    });

    const service = await prisma.service.create({
      data: {
        providerId: provider.id,
        title: "Old Town street food walk",
        location: "Bangkok – Yaowarat & Old Town",
        rate: 450,
      },
    });
    createdServiceIds.push(service.id);

    const booking = (bookingDate, bookingStatus) => ({
      serviceId: service.id,
      customerId: customer.id,
      bookingDate,
      appointmentDate: bookingDate,
      bookingStatus,
    });
    await prisma.booking.createMany({
      data: [
        booking(midMonth(0), "PENDING"), // counts
        booking(midMonth(0), "CANCELLED"), // cancelled: doesn't count
        booking(midMonth(-1), "PENDING"), // last month: doesn't count
      ],
    });

    const res = await agent.get("/api/providers/me/services");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: service.id,
        title: "Old Town street food walk",
        location: "Bangkok – Yaowarat & Old Town",
        rate: 450,
        rateUnit: "hour",
        coverPhotoUrl: null,
        status: "PUBLISHED",
        bookingsThisMonth: 1,
      },
    ]);
  });
});
