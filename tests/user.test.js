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

  it("rejects a phoneNumber that isn't a valid Thai number", async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, uniqueUser("profile_bad_phone"));

    const res = await agent.put("/api/users/me").send({ phoneNumber: "abc123" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phoneNumber/i);
  });
});

describe("POST /api/users/me/provider", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app)
      .post("/api/users/me/provider")
      .send({ idCard: "1234567890123" });
    expect(res.status).toBe(401);
  });

  it("adds a provider profile to a customer account, giving it both roles", async () => {
    const agent = request.agent(app);
    const payload = uniqueUser("both_roles");
    await registerAndLogin(agent, payload);

    const res = await agent
      .post("/api/users/me/provider")
      .send({ idCard: "1234567890123", languages: "English, Thai" });

    expect(res.status).toBe(201);
    expect(res.body.user.roles).toEqual(["CUSTOMER", "PROVIDER"]);

    // and the roles persist across a fresh login
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: payload.email, password: payload.password });
    expect(login.body.user.roles).toEqual(["CUSTOMER", "PROVIDER"]);
  });

  it("rejects a missing idCard", async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, uniqueUser("add_prov_no_id"));

    const res = await agent.post("/api/users/me/provider").send({ languages: "English" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/idCard/i);
  });

  it("rejects an idCard that is not 13 digits", async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, uniqueUser("add_prov_bad_id"));

    const res = await agent.post("/api/users/me/provider").send({ idCard: "123" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/13 digits/i);
  });

  it("rejects an emergencyContactPhone that isn't a valid Thai number", async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, uniqueUser("add_prov_bad_emergency_phone"));

    const res = await agent
      .post("/api/users/me/provider")
      .send({ idCard: "1234567890123", emergencyContactPhone: "999" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/emergencyContactPhone/i);
  });

  it("refuses to add a second provider profile", async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, uniqueUser("add_prov_twice"));

    await agent.post("/api/users/me/provider").send({ idCard: "1234567890123" });
    const res = await agent.post("/api/users/me/provider").send({ idCard: "1234567890123" });

    expect(res.status).toBe(409);
  });

  it("lets the newly added provider profile update provider-only fields", async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, uniqueUser("add_prov_then_edit"));
    await agent.post("/api/users/me/provider").send({ idCard: "1234567890123" });

    const res = await agent.put("/api/users/me").send({ bio: "Now guiding trips too" });

    expect(res.status).toBe(200);
    expect(res.body.user.provider.bio).toBe("Now guiding trips too");
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
