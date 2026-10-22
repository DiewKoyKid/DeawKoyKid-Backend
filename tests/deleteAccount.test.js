require("dotenv").config();
jest.mock("../src/services/mail.service");

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");
const { sendAccountDeletedEmail } = require("../src/services/mail.service");
const {
  PROFILE_PHOTO_DIR,
  PROFILE_PHOTO_URL_PREFIX,
} = require("../src/middlewares/profilePhotoUpload");

// Tracked by id: deletion renames the username
const createdUserIds = [];
const createdServiceIds = [];

function uniqueUser(prefix) {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const username = `${prefix}_${suffix}`;
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
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
});

async function registerAndLogin(agent, payload, registerPath = "/api/auth/register") {
  const registerRes = await agent.post(registerPath).send(payload);
  createdUserIds.push(registerRes.body.user.id);
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ email: payload.email, password: payload.password });
  return loginRes.body.user;
}

async function loginAsCustomer(prefix = "del_customer") {
  const agent = request.agent(app);
  const payload = uniqueUser(prefix);
  const user = await registerAndLogin(agent, payload);
  return { agent, user, payload };
}

async function loginAsProviderWithService(prefix = "del_provider") {
  const agent = request.agent(app);
  const payload = { ...uniqueUser(prefix), idCard: "1234567890123" };
  const user = await registerAndLogin(agent, payload, "/api/auth/register/provider");
  const service = await prisma.service.create({
    data: { providerId: user.id, title: "Old Town street food walk", location: "Bangkok", rate: 450 },
  });
  createdServiceIds.push(service.id);
  return { agent, user, payload, service };
}

// Statuses are set directly: this story only reads them
function createBooking(serviceId, customerId, bookingStatus) {
  return prisma.booking.create({
    data: {
      serviceId,
      customerId,
      bookingDate: new Date("2026-10-20"),
      appointmentDate: new Date("2026-11-05"),
      bookingStatus,
    },
  });
}

function deleteAccount(agent, password = "correct-horse-battery-staple") {
  return agent.delete("/api/users/me").send({ password });
}

function snapshotUser(id) {
  return prisma.user.findUnique({ where: { id }, include: { provider: true } });
}

describe("DELETE /api/users/me (US2-3)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).delete("/api/users/me").send({ password: "anything" });
    expect(res.status).toBe(401);
  });

  it("requires the password", async () => {
    const { agent, user } = await loginAsCustomer();

    const res = await agent.delete("/api/users/me").send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
    expect((await snapshotUser(user.id)).deletedAt).toBeNull();
  });

  it("rejects a wrong password and changes nothing", async () => {
    const { agent, user } = await loginAsCustomer();
    const before = await snapshotUser(user.id);

    const res = await deleteAccount(agent, "not-my-password");

    expect(res.status).toBe(401);
    expect(await snapshotUser(user.id)).toEqual(before);
    expect(sendAccountDeletedEmail).not.toHaveBeenCalled();
  });

  describe("with no booking in progress", () => {
    it("deactivates and anonymises the account, signs out and emails a confirmation", async () => {
      const { agent, user, payload } = await loginAsCustomer();
      const photoName = `${user.id}-delete-test.png`;
      fs.writeFileSync(path.join(PROFILE_PHOTO_DIR, photoName), "not really a png");
      await prisma.user.update({
        where: { id: user.id },
        data: {
          gender: "F",
          bdate: new Date("2000-01-31"),
          bankAccount: "1234567890",
          phoneNumber: "0812345678",
          instagram: "insta",
          line: "line",
          facebook: "fb",
          profilePhotoUrl: `${PROFILE_PHOTO_URL_PREFIX}${photoName}`,
        },
      });
      await prisma.notification.create({
        data: { userId: user.id, type: "BOOKING_CONFIRMED", message: "Your booking was confirmed." },
      });
      const before = await snapshotUser(user.id);

      const res = await deleteAccount(agent);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: "account deleted" });
      expect(res.headers["set-cookie"].join(";")).toMatch(/token=;.*Expires=Thu, 01 Jan 1970/);

      const after = await snapshotUser(user.id);
      expect(after.deletedAt).toBeInstanceOf(Date);
      expect(after).toMatchObject({
        username: `deleted_${user.id}`,
        email: null,
        firstname: "Deleted",
        lastname: "User",
        gender: null,
        bdate: null,
        bankAccount: null,
        phoneNumber: null,
        instagram: null,
        line: null,
        facebook: null,
        profilePhotoUrl: null,
        consentAt: null,
      });
      expect(after.password).not.toBe(before.password);
      expect(after.password).toMatch(/^\$2[aby]\$/); // still a bcrypt hash
      expect(fs.existsSync(path.join(PROFILE_PHOTO_DIR, photoName))).toBe(false);
      expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);

      expect(sendAccountDeletedEmail).toHaveBeenCalledTimes(1);
      expect(sendAccountDeletedEmail).toHaveBeenCalledWith({ to: payload.email, firstname: "Test" });
    });

    it("still succeeds when the confirmation email fails", async () => {
      const { agent, user } = await loginAsCustomer();
      sendAccountDeletedEmail.mockRejectedValueOnce(new Error("SMTP is down"));
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

      const res = await deleteAccount(agent);

      expect(res.status).toBe(200);
      expect((await snapshotUser(user.id)).deletedAt).toBeInstanceOf(Date);
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe("with a booking in progress", () => {
    it.each(["CONFIRMED", "WAITING_FOR_CONFIRMATION"])(
      "refuses a customer with a %s booking and changes nothing",
      async (bookingStatus) => {
        const { service } = await loginAsProviderWithService();
        const { agent, user } = await loginAsCustomer();
        const booking = await createBooking(service.id, user.id, bookingStatus);
        const before = await snapshotUser(user.id);

        const res = await deleteAccount(agent);

        expect(res.status).toBe(409);
        expect(res.body.bookings).toEqual([{
          id: booking.id,
          bookingStatus,
          appointmentDate: "2026-11-05",
          service: { title: "Old Town street food walk" },
        }]);
        expect(await snapshotUser(user.id)).toEqual(before);
        expect(sendAccountDeletedEmail).not.toHaveBeenCalled();
        // and they're still signed in
        expect((await agent.get("/api/users/me")).status).toBe(200);
      },
    );

    it("refuses a provider with an active booking on their service", async () => {
      const { agent, user, service } = await loginAsProviderWithService();
      const { user: customer } = await loginAsCustomer();
      const booking = await createBooking(service.id, customer.id, "CONFIRMED");
      const before = await snapshotUser(user.id);

      const res = await deleteAccount(agent);

      expect(res.status).toBe(409);
      expect(res.body.bookings.map((b) => b.id)).toEqual([booking.id]);
      expect(await snapshotUser(user.id)).toEqual(before);
      expect((await prisma.service.findUnique({ where: { id: service.id } })).isPublished).toBe(true);
      expect(sendAccountDeletedEmail).not.toHaveBeenCalled();
    });
  });

  it("deletes a provider whose bookings are all finished and unpublishes their services", async () => {
    const { agent, user, service } = await loginAsProviderWithService();
    const { user: customer } = await loginAsCustomer();
    for (const status of ["COMPLETED", "CANCELLED", "REJECTED", "EXPIRED"]) {
      await createBooking(service.id, customer.id, status);
    }
    await prisma.provider.update({
      where: { userId: user.id },
      data: {
        bio: "Local guide",
        languages: "Thai, English",
        interests: ["food"],
        serviceArea: ["Bangkok"],
        emergencyContactName: "Mum",
        emergencyContactPhone: "0898765432",
        avgRating: 4.5,
      },
    });

    const res = await deleteAccount(agent);

    expect(res.status).toBe(200);
    const after = await snapshotUser(user.id);
    expect(after.deletedAt).toBeInstanceOf(Date);
    expect(after.provider).toMatchObject({
      idCard: null,
      bio: null,
      languages: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      interests: [],
      serviceArea: [],
    });
    expect(Number(after.provider.avgRating)).toBe(4.5);
    expect((await prisma.service.findUnique({ where: { id: service.id } })).isPublished).toBe(false);
    // the bookings stay, still pointing at the service
    expect(await prisma.booking.count({ where: { serviceId: service.id } })).toBe(4);
  });

  describe("after deletion", () => {
    let user;
    let payload;
    let oldToken;

    beforeAll(async () => {
      const agent = request.agent(app);
      payload = uniqueUser("del_after");
      const registerRes = await agent.post("/api/auth/register").send(payload);
      user = registerRes.body.user;
      createdUserIds.push(user.id);
      const loginRes = await agent
        .post("/api/auth/login")
        .send({ email: payload.email, password: payload.password });
      oldToken = loginRes.headers["set-cookie"][0].match(/token=([^;]+)/)[1];

      expect((await deleteAccount(agent)).status).toBe(200);
    });

    it("rejects a token issued before the deletion", async () => {
      const res = await request(app)
        .get("/api/users/me")
        .set("Authorization", `Bearer ${oldToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("account has been deleted");
    });

    it("can't log in with the old email or the new username", async () => {
      const byEmail = await request(app)
        .post("/api/auth/login")
        .send({ email: payload.email, password: payload.password });
      const byUsername = await request(app)
        .post("/api/auth/login")
        .send({ username: `deleted_${user.id}`, password: payload.password });

      expect(byEmail.status).toBe(401);
      expect(byUsername.status).toBe(401);
      expect(byUsername.body.error).toBe("invalid email or password");
    });

    it("lets the same person register again with the same email and username", async () => {
      const res = await request(app).post("/api/auth/register").send(payload);

      expect(res.status).toBe(201);
      createdUserIds.push(res.body.user.id);
      expect(res.body.user.id).not.toBe(user.id);
    });

    it("hides the public profile", async () => {
      const res = await request(app).get(`/api/users/${user.id}`);
      expect(res.status).toBe(404);
    });
  });
});
