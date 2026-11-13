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

async function registerUser(prefix) {
  const payload = uniqueUser(prefix);
  await request(app).post("/api/auth/register").send(payload);
  return payload;
}

function login(payload, password) {
  return request(app).post("/api/auth/login").send({ email: payload.email, password });
}

function lockoutState(payload) {
  return prisma.user.findUnique({
    where: { username: payload.username },
    select: { failedLoginAttempts: true, lockedUntil: true },
  });
}

describe("POST /api/auth/login lockout (US1-3, TC26)", () => {
  it("answers 401 to the first 4 wrong passwords", async () => {
    const payload = await registerUser("lockout_four");

    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await login(payload, "wrong-password");
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "invalid email or password" });
    }

    expect(await lockoutState(payload)).toEqual({ failedLoginAttempts: 4, lockedUntil: null });
  });

  it("locks the account for 15 minutes on the 5th wrong password", async () => {
    const payload = await registerUser("lockout_fifth");
    for (let attempt = 1; attempt <= 4; attempt++) await login(payload, "wrong-password");

    const before = Date.now();
    const res = await login(payload, "wrong-password");

    expect(res.status).toBe(423);
    expect(res.body).toEqual({ error: "invalid email or password; the account is locked for 15 minutes" });
    const state = await lockoutState(payload);
    expect(state.failedLoginAttempts).toBe(0);
    const lockMs = state.lockedUntil.getTime() - before;
    expect(lockMs).toBeGreaterThanOrEqual(15 * 60 * 1000 - 1000);
    expect(lockMs).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
  });

  it("refuses even the correct password while the account is locked", async () => {
    const payload = await registerUser("lockout_correct");
    for (let attempt = 1; attempt <= 5; attempt++) await login(payload, "wrong-password");

    const res = await login(payload, payload.password);

    expect(res.status).toBe(423);
    expect(res.body).toEqual({ error: "this account is temporarily locked; try again later" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("logs in once the lock has passed and resets the counter", async () => {
    const payload = await registerUser("lockout_expired");
    await prisma.user.update({
      where: { username: payload.username },
      data: { failedLoginAttempts: 3, lockedUntil: new Date(Date.now() - 1000) },
    });

    const res = await login(payload, payload.password);

    expect(res.status).toBe(200);
    expect(await lockoutState(payload)).toEqual({ failedLoginAttempts: 0, lockedUntil: null });
  });

  it("resets the counter after a successful login", async () => {
    const payload = await registerUser("lockout_reset");
    for (let attempt = 1; attempt <= 4; attempt++) await login(payload, "wrong-password");

    expect((await login(payload, payload.password)).status).toBe(200);
    // so the next wrong password is the first again, not the 5th
    expect((await login(payload, "wrong-password")).status).toBe(401);
    expect((await lockoutState(payload)).failedLoginAttempts).toBe(1);
  });

  it("doesn't count attempts on an unknown account", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody-here@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid email or password" });
  });

  it("keeps answering 401 for a deleted account and doesn't count it", async () => {
    const payload = await registerUser("lockout_deleted");
    await prisma.user.update({ where: { username: payload.username }, data: { deletedAt: new Date() } });

    for (let attempt = 1; attempt <= 6; attempt++) {
      const res = await login(payload, "wrong-password");
      expect(res.status).toBe(401);
    }

    expect(await lockoutState(payload)).toEqual({ failedLoginAttempts: 0, lockedUntil: null });
  });
});
