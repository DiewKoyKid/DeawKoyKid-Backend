// Real PostgreSQL persistence and authenticated cookie access (Docker database).
require("dotenv").config();
const { randomUUID } = require("crypto");
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");
const { signToken } = require("../src/utils/jwt");

const ids = { customer: randomUUID(), provider: randomUUID(), service: randomUUID(), booking: randomUUID() };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
const cookie = (id) => `token=${signToken({ userId: id })}`;

beforeAll(async () => {
  for (const role of ["customer", "provider"]) {
    await prisma.user.create({ data: {
      id: ids[role], username: `chat_${ids[role]}`, password: "test-only-unused",
      firstname: "Chat", lastname: role, [role]: { create: {} },
    } });
  }
  await prisma.service.create({ data: {
    id: ids.service, providerId: ids.provider, title: "Chat photo test", location: "Bangkok", rate: 100,
  } });
  await prisma.booking.create({ data: {
    id: ids.booking, serviceId: ids.service, customerId: ids.customer,
    bookingDate: new Date(), appointmentDate: new Date(), bookingStatus: "CONFIRMED",
  } });
});

afterAll(async () => {
  await prisma.chatLog.deleteMany({ where: { bookingId: ids.booking } });
  await prisma.booking.deleteMany({ where: { id: ids.booking } });
  await prisma.service.deleteMany({ where: { id: ids.service } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.customer, ids.provider] } } });
  await prisma.$disconnect();
});

it("persists a photo and caption, reloads history, and serves the original bytes with the login cookie", async () => {
  const sent = await request(app).post(`/api/bookings/${ids.booking}/messages/image`)
    .set("Cookie", cookie(ids.customer))
    .field("content", "Meet here")
    .attach("image", PNG, { filename: "meeting.png", contentType: "image/png" });
  expect(sent.status).toBe(201);
  const row = await prisma.chatLog.findUnique({ where: { id: sent.body.message.id } });
  expect(Buffer.from(row.imageData)).toEqual(PNG);
  const history = await request(app).get(`/api/bookings/${ids.booking}/messages`)
    .set("Cookie", cookie(ids.provider));
  expect(history.status).toBe(200);
  expect(history.body.messages).toEqual([sent.body.message]);
  const downloaded = await request(app).get(sent.body.message.imageUrl).set("Cookie", cookie(ids.provider));
  expect(downloaded.status).toBe(200);
  expect(downloaded.body).toEqual(PNG);
  expect((await request(app).get(sent.body.message.imageUrl)).status).toBe(401);
});
