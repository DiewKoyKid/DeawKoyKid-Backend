require("dotenv").config();
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");

const createdUsernames = [];

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
  await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
  await prisma.$disconnect();
});

async function registerAndLogin(agent, payload) {
  await agent.post("/api/auth/register").send(payload);
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ email: payload.email, password: payload.password });
  return loginRes.body.user;
}

describe("GET /api/users/me", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/users/me");
    expect(res.status).toBe(401);
  });

  it("returns the authenticated user's full profile", async () => {
    const agent = request.agent(app);
    const payload = uniqueUser("profile_me");
    await registerAndLogin(agent, payload);

    const res = await agent.get("/api/users/me");

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: payload.username, email: payload.email });
  });
});

describe("PUT /api/users/me", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).put("/api/users/me").send({ firstname: "Nope" });
    expect(res.status).toBe(401);
  });

  it("updates the authenticated user's own profile", async () => {
    const agent = request.agent(app);
    const payload = uniqueUser("profile_update");
    await registerAndLogin(agent, payload);

    const res = await agent.put("/api/users/me").send({ firstname: "Updated" });

    expect(res.status).toBe(200);
    expect(res.body.user.firstname).toBe("Updated");
  });

  it("rejects provider-only fields on a customer account", async () => {
    const agent = request.agent(app);
    const payload = uniqueUser("profile_customer_bio");
    await registerAndLogin(agent, payload);

    const res = await agent.put("/api/users/me").send({ bio: "I am not a provider" });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/users/:id", () => {
  it("returns only public fields", async () => {
    const agent = request.agent(app);
    const payload = uniqueUser("profile_public");
    const user = await registerAndLogin(agent, payload);

    const res = await request(app).get(`/api/users/${user.id}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, username: payload.username });
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.bankAccount).toBeUndefined();
    expect(res.body.user.phoneNumber).toBeUndefined();
  });

  it("returns 404 for a non-existent user", async () => {
    const res = await request(app).get("/api/users/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });
});
