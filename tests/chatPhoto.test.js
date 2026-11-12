// Chat photos (US7-2): POST /api/bookings/:id/messages/photo accepts JPG/PNG
// up to 5 MB from the booking's customer or provider. Runs without PostgreSQL
// and without writing files.
process.env.JWT_SECRET = "chat-photo-test-secret";

jest.mock("../src/lib/prisma", () => ({
  user: { findUnique: jest.fn() },
  booking: { findUnique: jest.fn() },
  chatLog: { findMany: jest.fn(), create: jest.fn() },
}));
jest.mock("fs/promises", () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../src/socket/chat.socket", () => ({ broadcastMessage: jest.fn() }));

const express = require("express");
const request = require("supertest");
const fs = require("fs/promises");
const prisma = require("../src/lib/prisma");
const { broadcastMessage } = require("../src/socket/chat.socket");
const { signToken } = require("../src/utils/jwt");
const bookingRoutes = require("../src/routes/booking.routes");

const app = express();
app.use(express.json());
app.use("/api/bookings", bookingRoutes);

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(200, 1),
]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);

let booking;
beforeEach(() => {
  jest.clearAllMocks();
  booking = {
    id: "booking-id",
    customerId: "customer-id",
    bookingStatus: "CONFIRMED",
    service: { providerId: "provider-id", title: "Food walk" },
  };
  prisma.user.findUnique.mockResolvedValue({ deletedAt: null });
  prisma.booking.findUnique.mockImplementation(async ({ where }) =>
    where.id === booking.id ? booking : null
  );
  prisma.chatLog.create.mockImplementation(async ({ data }) => ({
    id: "msg-1",
    ...data,
    imageUrl: data.imageUrl ?? null,
    timestamp: new Date("2026-11-12T13:00:00Z"),
    sender: { firstname: "Cus", lastname: "Tomer" },
  }));
});

function send(userId, attach) {
  const req = request(app).post("/api/bookings/booking-id/messages/photo");
  if (userId) req.set("Authorization", `Bearer ${signToken({ userId })}`);
  return attach ? attach(req) : req;
}

it("sends a PNG with a caption and pushes it to the chat", async () => {
  const res = await send("customer-id", (r) =>
    r.field("content", "  This is the meeting point  ")
      .attach("photo", PNG, { filename: "map.png", contentType: "image/png" })
  );
  expect(res.status).toBe(201);
  expect(res.body.message).toMatchObject({
    bookingId: "booking-id",
    senderId: "customer-id",
    content: "This is the meeting point",
    imageUrl: expect.stringMatching(/^\/uploads\/chat-photos\/[0-9a-f-]{36}\.png$/),
  });
  expect(fs.writeFile).toHaveBeenCalledWith(expect.stringMatching(/\.png$/), expect.any(Buffer));
  expect(broadcastMessage).toHaveBeenCalledWith(res.body.message);
});

it("lets the provider send a JPG without a caption", async () => {
  const res = await send("provider-id", (r) =>
    r.attach("photo", JPG, { filename: "spot.jpg", contentType: "image/jpeg" })
  );
  expect(res.status).toBe(201);
  expect(res.body.message.content).toBe("");
  expect(res.body.message.imageUrl).toMatch(/\.jpg$/);
});

it("refuses an MP4 video of 30 MB", async () => {
  const video = Buffer.alloc(30 * 1024 * 1024, 0);
  const res = await send("customer-id", (r) =>
    r.attach("photo", video, { filename: "trip.mp4", contentType: "video/mp4" })
  );
  expect([413, 415]).toContain(res.status);
  expect(res.body.error).toBeTruthy();
  expect(prisma.chatLog.create).not.toHaveBeenCalled();
  expect(fs.writeFile).not.toHaveBeenCalled();
});

it("refuses a JPG over 5 MB", async () => {
  const big = Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024, 0)]);
  const res = await send("customer-id", (r) =>
    r.attach("photo", big, { filename: "big.jpg", contentType: "image/jpeg" })
  );
  expect(res.status).toBe(413);
  expect(res.body.error).toMatch(/5 MB/);
  expect(prisma.chatLog.create).not.toHaveBeenCalled();
});

it("refuses a file that claims to be a PNG but isn't one", async () => {
  const res = await send("customer-id", (r) =>
    r.attach("photo", Buffer.from("not really a png"), { filename: "x.png", contentType: "image/png" })
  );
  expect(res.status).toBe(415);
  expect(fs.writeFile).not.toHaveBeenCalled();
});

it("returns 400 when no photo is attached", async () => {
  const res = await send("customer-id", (r) => r.field("content", "hello"));
  expect(res.status).toBe(400);
});

it("returns 403 to someone outside the booking", async () => {
  const res = await send("stranger-id", (r) =>
    r.attach("photo", PNG, { filename: "map.png", contentType: "image/png" })
  );
  expect(res.status).toBe(403);
  expect(fs.writeFile).not.toHaveBeenCalled();
});

it("returns 403 once the booking is no longer confirmed", async () => {
  booking.bookingStatus = "COMPLETED";
  const res = await send("customer-id", (r) =>
    r.attach("photo", PNG, { filename: "map.png", contentType: "image/png" })
  );
  expect(res.status).toBe(403);
});

it("requires a token", async () => {
  expect((await send(null)).status).toBe(401);
});
