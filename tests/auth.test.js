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

describe("POST /api/auth/register", () => {
  it("registers a customer with valid data", async () => {
    const payload = uniqueUser("register_valid");

    const res = await request(app).post("/api/auth/register").send(payload);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      username: payload.username,
      email: payload.email,
      firstname: payload.firstname,
      lastname: payload.lastname,
    });
    expect(res.body.user.password).toBeUndefined();
  });

  it("rejects registration without consent", async () => {
    const payload = uniqueUser("register_no_consent");
    delete payload.consent;

    const res = await request(app).post("/api/auth/register").send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/consent/i);
  });

  it("rejects registration when consent is not exactly true", async () => {
    const payload = uniqueUser("register_falsy_consent");
    payload.consent = "yes";

    const res = await request(app).post("/api/auth/register").send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/consent/i);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const payload = uniqueUser("register_weak_password");
    payload.password = "short1";

    const res = await request(app).post("/api/auth/register").send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  it("rejects a duplicate username", async () => {
    const payload = uniqueUser("register_dup_username");
    await request(app).post("/api/auth/register").send(payload);

    const secondPayload = { ...payload, email: `${payload.username}_2@example.com` };
    const res = await request(app).post("/api/auth/register").send(secondPayload);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/username/i);
  });

  it("rejects a duplicate email", async () => {
    const payload = uniqueUser("register_dup_email");
    await request(app).post("/api/auth/register").send(payload);

    const secondPayload = uniqueUser("register_dup_email_2");
    secondPayload.email = payload.email;
    const res = await request(app).post("/api/auth/register").send(secondPayload);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/email/i);
  });
});

describe("POST /api/auth/register/provider", () => {
  it("registers a provider with valid data", async () => {
    const payload = uniqueUser("register_provider_valid");
    payload.idCard = "1234567890123";

    const res = await request(app).post("/api/auth/register/provider").send(payload);

    expect(res.status).toBe(201);
    expect(res.body.user.provider).toMatchObject({ status: "PENDING" });
  });

  it("rejects a missing idCard", async () => {
    const payload = uniqueUser("register_provider_no_id");

    const res = await request(app).post("/api/auth/register/provider").send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/idCard/i);
  });

  it("rejects an idCard that is not 13 digits", async () => {
    const payload = uniqueUser("register_provider_bad_id");
    payload.idCard = "123";

    const res = await request(app).post("/api/auth/register/provider").send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/13 digits/i);
  });

  it("rejects registration without consent", async () => {
    const payload = uniqueUser("register_provider_no_consent");
    payload.idCard = "9876543210123";
    delete payload.consent;

    const res = await request(app).post("/api/auth/register/provider").send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/consent/i);
  });
});

describe("POST /api/auth/login", () => {
  async function registerUser() {
    const payload = uniqueUser("login_user");
    await request(app).post("/api/auth/register").send(payload);
    return payload;
  }

  it("logs in with valid credentials and sets an httpOnly cookie", async () => {
    const payload = await registerUser();

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: payload.email, password: payload.password });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: payload.username, email: payload.email });

    const cookies = res.headers["set-cookie"] || [];
    const tokenCookie = cookies.find((c) => c.startsWith("token="));
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie).toMatch(/HttpOnly/i);
  });

  it("rejects an unknown email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "no-such-user@example.com", password: "whatever123" });

    expect(res.status).toBe(401);
  });

  it("rejects the wrong password", async () => {
    const payload = await registerUser();

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: payload.email, password: "wrong-password" });

    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session cookie", async () => {
    const agent = request.agent(app);
    const payload = uniqueUser("logout_user");
    await agent.post("/api/auth/register").send(payload);
    await agent.post("/api/auth/login").send({ email: payload.email, password: payload.password });

    const res = await agent.post("/api/auth/logout");

    expect(res.status).toBe(200);
    const cookies = res.headers["set-cookie"] || [];
    const tokenCookie = cookies.find((c) => c.startsWith("token="));
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie).toMatch(/token=;/);
  });
});
