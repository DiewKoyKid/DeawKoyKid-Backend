// PostgreSQL integration tests; SMTP is stubbed so no external email is sent.
require("dotenv").config();
jest.mock("../src/services/mail.service", () => ({ sendBookingNotificationEmail: jest.fn() }));
const { randomUUID } = require("crypto");
const request = require("supertest");
const prisma = require("../src/lib/prisma");
const app = require("../src/app");
const { signToken } = require("../src/utils/jwt");
const { changeBookingStatus, bookingTransaction } = require("../src/services/booking.service");
const { sendBookingNotificationEmail } = require("../src/services/mail.service");
const ids = { customer: randomUUID(), provider: randomUUID(), service: randomUUID(), booking: randomUUID() };
const auth = (id) => `Bearer ${signToken({ userId: id })}`;

beforeAll(async () => {
  for (const role of ["customer", "provider"]) {
    await prisma.user.create({ data: {
      id: ids[role], username: `email_${ids[role]}`, email: `${ids[role]}@example.com`,
      password: "unused-test-password", firstname: "Test", lastname: role, [role]: { create: {} },
    } });
  }
  await prisma.service.create({ data: { id: ids.service, providerId: ids.provider, title: "Email test trip", location: "Bangkok", rate: 100 } });
  await prisma.booking.create({ data: { id: ids.booking, serviceId: ids.service, customerId: ids.customer,
    bookingDate: new Date(), appointmentDate: new Date(Date.now() + 7 * 86400000),
  } });
});
beforeEach(async () => {
  jest.clearAllMocks();
  sendBookingNotificationEmail.mockResolvedValue({ accepted: ["test@example.com"] });
  await prisma.notification.deleteMany({ where: { bookingId: ids.booking } });
  await prisma.booking.update({ where: { id: ids.booking }, data: { bookingStatus: "WAITING_FOR_CONFIRMATION", createdAt: new Date() } });
  await prisma.user.updateMany({ where: { id: { in: [ids.customer, ids.provider] } }, data: { emailNotificationsEnabled: true } });
});
afterAll(async () => {
  await prisma.notification.deleteMany({ where: { bookingId: ids.booking } });
  await prisma.booking.deleteMany({ where: { id: ids.booking } });
  await prisma.service.deleteMany({ where: { id: ids.service } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.customer, ids.provider] } } });
  await prisma.$disconnect();
});

const confirm = () => changeBookingStatus(ids.booking, "CONFIRMED", { actorId: ids.provider });
const rows = () => prisma.notification.findMany({ where: { bookingId: ids.booking } });
const settings = (method, body, id = ids.customer) => request(app)[method]("/api/notifications/settings")
  .set("Authorization", auth(id)).send(body);

it("creates only an in-app notification when email is off", async () => {
  await settings("patch", { emailNotificationsEnabled: false });
  await confirm();
  expect(await rows()).toEqual([expect.objectContaining({ userId: ids.customer, isRead: false })]);
  expect(sendBookingNotificationEmail).not.toHaveBeenCalled();
});

it("sends immediately after commit, within one minute, without duplicating a repeated change", async () => {
  const started = Date.now();
  let observed;
  sendBookingNotificationEmail.mockImplementation(async () => {
    const booking = await prisma.booking.findUnique({ where: { id: ids.booking } });
    observed = { status: booking.bookingStatus, notifications: await rows(), elapsed: Date.now() - started };
  });
  await confirm();
  expect(observed.status).toBe("CONFIRMED");
  expect(observed.notifications).toHaveLength(1);
  expect(observed.elapsed).toBeLessThan(60_000);
  expect(sendBookingNotificationEmail).toHaveBeenCalledTimes(1);
  expect(sendBookingNotificationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: `${ids.customer}@example.com` }));
  await confirm();
  expect(sendBookingNotificationEmail).toHaveBeenCalledTimes(1);
});

it("does not send when the outer booking transaction rolls back", async () => {
  await expect(bookingTransaction(async (tx) => {
    await changeBookingStatus(ids.booking, "CONFIRMED", { actorId: ids.provider, client: tx });
    throw new Error("rollback");
  })).rejects.toThrow("rollback");
  expect(await rows()).toEqual([]);
  expect(sendBookingNotificationEmail).not.toHaveBeenCalled();
});

it("keeps a successful booking and in-app notification when email fails", async () => {
  sendBookingNotificationEmail.mockRejectedValueOnce(new Error("SMTP unavailable"));
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await confirm();
    expect(result.booking.bookingStatus).toBe("CONFIRMED");
    expect(await rows()).toHaveLength(1);
    expect(log).toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

it.each(["REJECTED", "EXPIRED", "CANCELLED", "COMPLETED"])("emails recipients for %s", async (status) => {
  await changeBookingStatus(ids.booking, status);
  expect(await rows()).toHaveLength(2);
  expect(sendBookingNotificationEmail).toHaveBeenCalledTimes(2);
});

it("sends email for the provider status and customer cancel endpoints", async () => {
  expect((await request(app).patch(`/api/bookings/${ids.booking}/status`)
    .set("Authorization", auth(ids.provider)).send({ status: "CONFIRMED" })).status).toBe(200);
  expect(sendBookingNotificationEmail).toHaveBeenCalledTimes(1);
  expect((await request(app).patch(`/api/bookings/${ids.booking}/cancel`)
    .set("Authorization", auth(ids.customer))).status).toBe(200);
  expect(sendBookingNotificationEmail).toHaveBeenCalledTimes(2);
});

it("emails both sides when a provider decision discovers an expired booking", async () => {
  await prisma.booking.update({ where: { id: ids.booking }, data: { createdAt: new Date(Date.now() - 25 * 3600000) } });
  expect((await request(app).patch(`/api/bookings/${ids.booking}/status`)
    .set("Authorization", auth(ids.provider)).send({ status: "CONFIRMED" })).status).toBe(409);
  expect(sendBookingNotificationEmail).toHaveBeenCalledTimes(2);
});

it("emails both sides after the expiry job commits", async () => {
  await prisma.booking.update({ where: { id: ids.booking }, data: { createdAt: new Date(Date.now() - 25 * 3600000) } });
  const { expireUnansweredBooking } = require("../src/services/bookingExpiry.service");
  await expireUnansweredBooking(ids.booking);
  expect(sendBookingNotificationEmail).toHaveBeenCalledTimes(2);
});

it("persists only the signed-in user's preference and rejects invalid input", async () => {
  expect((await request(app).get("/api/notifications/settings")).status).toBe(401);
  expect((await request(app).patch("/api/notifications/settings").send({ emailNotificationsEnabled: false })).status).toBe(401);
  expect((await settings("get")).body).toEqual({ emailNotificationsEnabled: true });
  expect((await settings("patch", { emailNotificationsEnabled: "false" })).status).toBe(400);
  await settings("patch", { emailNotificationsEnabled: false, userId: ids.provider });
  expect((await settings("get")).body.emailNotificationsEnabled).toBe(false);
  expect((await settings("get", undefined, ids.provider)).body.emailNotificationsEnabled).toBe(true);
});
