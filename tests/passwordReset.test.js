require("dotenv").config();
jest.mock("../src/services/mail.service");

const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");
const { sendPasswordResetEmail } = require("../src/services/mail.service");
const { hashToken } = require("../src/services/passwordReset.service");

const createdUserIds = [];
const OLD_PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "a-brand-new-password";

function uniqueUser(prefix) {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const username = `${prefix}_${suffix}`;
  return {
    username,
    email: `${username}@example.com`,
    password: OLD_PASSWORD,
    firstname: "Test",
    lastname: "User",
    consent: true,
  };
}

async function registerUser(prefix = "reset") {
  const payload = uniqueUser(prefix);
  const res = await request(app).post("/api/auth/register").send(payload);
  createdUserIds.push(res.body.user.id);
  return { payload, id: res.body.user.id };
}

// Asks for a reset link and returns the raw token that the email would carry
async function requestToken(email) {
  sendPasswordResetEmail.mockClear();
  const res = await request(app).post("/api/auth/forgot-password").send({ email });
  expect(res.status).toBe(200);
  return sendPasswordResetEmail.mock.calls[0][0].token;
}

function login(email, password) {
  return request(app).post("/api/auth/login").send({ email, password });
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  // Reset tokens cascade from users
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("POST /api/auth/forgot-password (US1-5)", () => {
  it("emails a reset link to a registered user and stores only a hash of the token", async () => {
    const { payload, id } = await registerUser();

    const res = await request(app).post("/api/auth/forgot-password").send({ email: payload.email });

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const { to, token } = sendPasswordResetEmail.mock.calls[0][0];
    expect(to).toBe(payload.email);

    const rows = await prisma.passwordResetToken.findMany({ where: { userId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].usedAt).toBeNull();
    // 15-minute expiry, with a little slack for test timing
    const ttlMs = rows[0].expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(14 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("matches the email case-insensitively", async () => {
    const { payload } = await registerUser();

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: ` ${payload.email.toUpperCase()} ` });

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it("answers an unregistered email the same way but sends nothing", async () => {
    const { payload } = await registerUser();
    const known = await request(app).post("/api/auth/forgot-password").send({ email: payload.email });
    jest.clearAllMocks();

    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: `nobody_${Date.now()}@example.com` });

    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("sends nothing for a deleted account", async () => {
    const { payload, id } = await registerUser();
    await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });

    const res = await request(app).post("/api/auth/forgot-password").send({ email: payload.email });

    expect(res.status).toBe(200);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(await prisma.passwordResetToken.count({ where: { userId: id } })).toBe(0);
  });

  it("rejects a missing or malformed email", async () => {
    const missing = await request(app).post("/api/auth/forgot-password").send({});
    const malformed = await request(app).post("/api/auth/forgot-password").send({ email: "not-an-email" });

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toMatch(/email/i);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("still answers 200 when the email cannot be sent", async () => {
    const { payload } = await registerUser();
    sendPasswordResetEmail.mockRejectedValueOnce(new Error("smtp down"));
    const logSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).post("/api/auth/forgot-password").send({ email: payload.email });

    expect(res.status).toBe(200);
    logSpy.mockRestore();
  });

  it("voids the earlier link when a new one is requested", async () => {
    const { payload } = await registerUser();
    const first = await requestToken(payload.email);
    const second = await requestToken(payload.email);

    const stale = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: first, password: NEW_PASSWORD });
    const fresh = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: second, password: NEW_PASSWORD });

    expect(stale.status).toBe(400);
    expect(fresh.status).toBe(200);
  });
});

describe("POST /api/auth/reset-password (US1-5)", () => {
  it("sets the new password so the user can log in with it", async () => {
    const { payload } = await registerUser();
    const token = await requestToken(payload.email);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect((await login(payload.email, NEW_PASSWORD)).status).toBe(200);
    expect((await login(payload.email, OLD_PASSWORD)).status).toBe(401);
  });

  it("stores the new password hashed", async () => {
    const { payload, id } = await registerUser();
    const token = await requestToken(payload.email);

    await request(app).post("/api/auth/reset-password").send({ token, password: NEW_PASSWORD });

    const user = await prisma.user.findUnique({ where: { id } });
    expect(user.password).not.toBe(NEW_PASSWORD);
    expect(user.password).toMatch(/^\$2[aby]\$/);
  });

  it("rejects an expired link and keeps the password", async () => {
    const { payload, id } = await registerUser();
    const token = await requestToken(payload.email);
    await prisma.passwordResetToken.updateMany({
      where: { userId: id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
    expect((await login(payload.email, OLD_PASSWORD)).status).toBe(200);
    expect((await login(payload.email, NEW_PASSWORD)).status).toBe(401);
  });

  it("rejects a link that was already used", async () => {
    const { payload } = await registerUser();
    const token = await requestToken(payload.email);
    await request(app).post("/api/auth/reset-password").send({ token, password: NEW_PASSWORD });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "another-new-password" });

    expect(res.status).toBe(400);
    expect((await login(payload.email, NEW_PASSWORD)).status).toBe(200);
    expect((await login(payload.email, "another-new-password")).status).toBe(401);
  });

  it("rejects a token that was never issued", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "0".repeat(64), password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });

  it("rejects a link for an account deleted after the request", async () => {
    const { payload, id } = await registerUser();
    const token = await requestToken(payload.email);
    await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    expect(res.status).toBe(400);
  });

  it("rejects a password shorter than 8 characters and keeps the link usable", async () => {
    const { payload } = await registerUser();
    const token = await requestToken(payload.email);

    const weak = await request(app).post("/api/auth/reset-password").send({ token, password: "short1" });
    const ok = await request(app).post("/api/auth/reset-password").send({ token, password: NEW_PASSWORD });

    expect(weak.status).toBe(400);
    expect(weak.body.error).toMatch(/password/i);
    expect(ok.status).toBe(200);
  });

  it("requires both the token and the password", async () => {
    const noToken = await request(app).post("/api/auth/reset-password").send({ password: NEW_PASSWORD });
    const noPassword = await request(app).post("/api/auth/reset-password").send({ token: "abc" });

    expect(noToken.status).toBe(400);
    expect(noPassword.status).toBe(400);
  });

  it("lets only one of two simultaneous requests use the link", async () => {
    const { payload } = await registerUser();
    const token = await requestToken(payload.email);

    const results = await Promise.all([
      request(app).post("/api/auth/reset-password").send({ token, password: NEW_PASSWORD }),
      request(app).post("/api/auth/reset-password").send({ token, password: "another-new-password" }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });
});
