require("dotenv").config();
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");

const createdUsernames = [];
const createdUserIds = [];

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
  // Services don't cascade from users, so remove them first.
  await prisma.service.deleteMany({ where: { providerId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
  await prisma.$disconnect();
});

async function registerAndLogin(agent, payload, registerPath = "/api/auth/register") {
  await agent.post(registerPath).send(payload);
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ email: payload.email, password: payload.password });
  createdUserIds.push(loginRes.body.user.id);
  return loginRes.body.user;
}

// Provider.status defaults to "PENDING"; approved providers are "APPROVED".
async function loginAsProvider(agent, prefix, status = "PENDING") {
  const payload = { ...uniqueUser(prefix), idCard: "1234567890123" };
  const user = await registerAndLogin(agent, payload, "/api/auth/register/provider");
  if (status !== "PENDING") {
    await prisma.provider.update({ where: { userId: user.id }, data: { status } });
  }
  return user;
}

const validService = () => ({
  title: "Old Town street food walk",
  description: "We'll eat our way down Yaowarat Road.",
  location: "Bangkok – Yaowarat & Old Town",
  rate: 450,
});

describe("POST /api/services", () => {
  describe("access", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app).post("/api/services").send(validService());
      expect(res.status).toBe(401);
    });

    it("rejects an account without a provider profile", async () => {
      const agent = request.agent(app);
      await registerAndLogin(agent, uniqueUser("svc_customer"));

      const res = await agent.post("/api/services").send(validService());

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/provider/i);
    });

    it("rejects a provider who is still pending approval", async () => {
      const agent = request.agent(app);
      const provider = await loginAsProvider(agent, "svc_pending");

      const res = await agent.post("/api/services").send(validService());

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/approved/i);
      expect(await prisma.service.count({ where: { providerId: provider.id } })).toBe(0);
    });
  });

  describe("creating a service", () => {
    let agent;
    let provider;

    beforeAll(async () => {
      agent = request.agent(app);
      provider = await loginAsProvider(agent, "svc_approved", "APPROVED");
    });

    it("creates the service for the signed-in provider and returns 201", async () => {
      const res = await agent.post("/api/services").send(validService());

      expect(res.status).toBe(201);
      expect(res.body.service).toEqual({
        id: expect.any(String),
        providerId: provider.id,
        title: "Old Town street food walk",
        description: "We'll eat our way down Yaowarat Road.",
        location: "Bangkok – Yaowarat & Old Town",
        rate: 450,
      });

      const saved = await prisma.service.findUnique({ where: { id: res.body.service.id } });
      expect(saved).toMatchObject({ providerId: provider.id, title: "Old Town street food walk" });
      expect(Number(saved.rate)).toBe(450);
    });

    it("ignores a providerId in the body and uses the signed-in provider", async () => {
      const res = await agent
        .post("/api/services")
        .send({ ...validService(), providerId: "someone-else" });

      expect(res.status).toBe(201);
      expect(res.body.service.providerId).toBe(provider.id);
    });

    it("trims the title and location", async () => {
      const res = await agent
        .post("/api/services")
        .send({ ...validService(), title: "  Temple walk  ", location: "  Bangkok  " });

      expect(res.status).toBe(201);
      expect(res.body.service).toMatchObject({ title: "Temple walk", location: "Bangkok" });
    });

    it.each([
      ["missing", undefined],
      ["null", null],
      ["blank", "   "],
    ])("stores a %s description as null", async (_label, description) => {
      const res = await agent.post("/api/services").send({ ...validService(), description });

      expect(res.status).toBe(201);
      expect(res.body.service.description).toBeNull();
    });

    it("accepts a title of exactly 150 characters and a location of exactly 200", async () => {
      const res = await agent
        .post("/api/services")
        .send({ ...validService(), title: "t".repeat(150), location: "l".repeat(200) });

      expect(res.status).toBe(201);
    });

    it.each([0.01, 450.5, 1234.56, 99999999.99])("accepts a rate of %s", async (rate) => {
      const res = await agent.post("/api/services").send({ ...validService(), rate });

      expect(res.status).toBe(201);
      expect(res.body.service.rate).toBe(rate);
    });

    // Two-decimal rates whose value * 100 isn't exact in floating point
    // (19.99 * 100 === 1998.9999999999998).
    it.each([19.99, 0.29, 1.1])("accepts a two-decimal rate of %s", async (rate) => {
      const res = await agent.post("/api/services").send({ ...validService(), rate });

      expect(res.status).toBe(201);
      expect(res.body.service.rate).toBe(rate);
    });
  });

  describe("validation", () => {
    let agent;
    let provider;

    beforeAll(async () => {
      agent = request.agent(app);
      provider = await loginAsProvider(agent, "svc_validation", "APPROVED");
    });

    afterAll(async () => {
      // None of the invalid requests should have saved anything.
      expect(await prisma.service.count({ where: { providerId: provider.id } })).toBe(0);
    });

    it.each([
      ["title is missing", { title: undefined }, /title is required/],
      ["title is blank", { title: "   " }, /title is required/],
      ["title is not a string", { title: 123 }, /title is required/],
      ["title is over 150 characters", { title: "t".repeat(151) }, /title must be at most 150/],
      ["location is missing", { location: undefined }, /location is required/],
      ["location is blank", { location: "  " }, /location is required/],
      ["location is over 200 characters", { location: "l".repeat(201) }, /location must be at most 200/],
      ["description is not a string", { description: 42 }, /description must be a string/],
      ["rate is missing", { rate: undefined }, /rate must be a positive number/],
      ["rate is 0", { rate: 0 }, /rate must be a positive number/],
      ["rate is negative", { rate: -10 }, /rate must be a positive number/],
      ["rate is a string", { rate: "450" }, /rate must be a positive number/],
      ["rate is over the column limit", { rate: 100000000 }, /rate must be a positive number/],
      ["rate has 3 decimal places", { rate: 450.123 }, /at most 2 decimal places/],
    ])("returns 400 when the %s", async (_label, override, message) => {
      const res = await agent.post("/api/services").send({ ...validService(), ...override });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    });

    it("returns 400 for an empty body", async () => {
      const res = await agent.post("/api/services").send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/title is required/);
    });
  });
});
