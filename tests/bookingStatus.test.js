// Route-level checks that can run without PostgreSQL. booking.test.js covers
// persistence, notifications, and competing transactions against the database.
process.env.JWT_SECRET = "booking-status-test-secret";

jest.mock("../src/lib/prisma", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  booking: { findUnique: jest.fn(), update: jest.fn() },
  notification: { createManyAndReturn: jest.fn() },
}));

const express = require("express");
const request = require("supertest");
const prisma = require("../src/lib/prisma");
const { signToken } = require("../src/utils/jwt");
const bookingRoutes = require("../src/routes/booking.routes");

const app = express();
app.use(express.json());
app.use("/api/bookings", bookingRoutes);

let booking;
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-19T12:00:00Z"));
  booking = {
    id: "booking-id", serviceId: "service-id", customerId: "customer-id",
    bookingDate: new Date("2026-10-19T00:00:00Z"),
    createdAt: new Date(Date.now()),
    appointmentDate: new Date("2026-10-26T00:00:00Z"),
    bookingStatus: "WAITING_FOR_CONFIRMATION", totalPrice: "450.00",
    duration: null, startTime: null, endTime: null,
    service: { providerId: "provider-id", title: "Food walk" },
  };
  // Interactive transaction clients do not expose $transaction.
  const { $transaction, ...tx } = prisma;
  prisma.$transaction.mockImplementation((run) => run(tx));
  prisma.booking.findUnique.mockImplementation(async () => booking);
  prisma.booking.update.mockImplementation(async ({ data }) => {
    Object.assign(booking, data);
    const { service, createdAt, ...fields } = booking;
    return { ...fields, ...data };
  });
  prisma.notification.createManyAndReturn.mockResolvedValue([]);
});

afterEach(() => jest.restoreAllMocks());

function patch(status, actor = "provider-id") {
  const req = request(app).patch("/api/bookings/booking-id/status");
  if (actor) req.set("Authorization", `Bearer ${signToken({ userId: actor })}`);
  return req.send({ status });
}

it("requires a valid token before accessing bookings", async () => {
  expect((await patch("CONFIRMED", null)).status).toBe(401);
  expect((await request(app).patch("/api/bookings/booking-id/status")
    .set("Authorization", "Bearer invalid").send({ status: "CONFIRMED" })).status).toBe(401);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it.each(["customer-id", "another-provider-id"])("denies %s without writing anything", async (actor) => {
  expect((await patch("CONFIRMED", actor)).status).toBe(403);
  expect(prisma.booking.update).not.toHaveBeenCalled();
  expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
});

it.each(["CONFIRMED", "REJECTED"])("allows the provider to set %s and notifies the customer", async (status) => {
  const res = await patch(status);
  expect(res.status).toBe(200);
  expect(res.body.booking).toMatchObject({
    id: booking.id, bookingStatus: status, totalPrice: 450,
    bookingDate: "2026-10-19", appointmentDate: "2026-10-26",
  });
  expect(res.body.booking.service).toBeUndefined();
  expect(prisma.notification.createManyAndReturn).toHaveBeenCalledWith({
    data: [expect.objectContaining({ userId: "customer-id", bookingId: booking.id, type: `BOOKING_${status}` })],
  });
});

it("returns 404 for an unknown booking", async () => {
  prisma.booking.findUnique.mockResolvedValue(null);
  expect((await patch("CONFIRMED")).status).toBe(404);
  expect(prisma.booking.update).not.toHaveBeenCalled();
});

it.each([undefined, null, {}, [], "confirmed", "EXPIRED", "CANCELLED", "COMPLETED", "WAITING_FOR_CONFIRMATION"])("rejects invalid status %p", async (status) => {
  expect((await patch(status)).status).toBe(400);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it.each(["REJECTED", "EXPIRED", "CANCELLED", "COMPLETED"])("does not confirm a %s booking", async (status) => {
  booking.bookingStatus = status;
  const res = await patch("CONFIRMED");
  expect(res.status).toBe(409);
  if (status === "EXPIRED") expect(res.body.error).toBe("This request has expired");
  expect(prisma.booking.update).not.toHaveBeenCalled();
  expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
});

it("returns the existing decision without writing or notifying again", async () => {
  booking.bookingStatus = "CONFIRMED";
  booking.totalPrice = null;
  const res = await patch("CONFIRMED");
  expect(res.status).toBe(200);
  expect(res.body.booking.totalPrice).toBeNull();
  expect(prisma.booking.update).not.toHaveBeenCalled();
  expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
  expect((await patch("CONFIRMED", "customer-id")).status).toBe(403);
});

it("returns a generic server error if the transaction fails", async () => {
  prisma.$transaction.mockRejectedValue(new Error("private database error"));
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const res = await patch("CONFIRMED");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  } finally {
    log.mockRestore();
  }
});

it.each(["CONFIRMED", "REJECTED"])("allows %s one millisecond before the deadline", async (status) => {
  booking.createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000 + 1);
  const res = await patch(status);
  expect(res.status).toBe(200);
  expect(res.body.booking.bookingStatus).toBe(status);
});

it.each([
  ["CONFIRMED", 0], ["REJECTED", 0], ["CONFIRMED", 1], ["REJECTED", 1],
])("expires instead of applying %s at the deadline plus %i ms", async (status, delay) => {
  booking.createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000 - delay);
  const res = await patch(status);
  expect(res.status).toBe(409);
  expect(res.body).toEqual({ error: "This request has expired" });
  expect(booking.bookingStatus).toBe("EXPIRED");
  expect(prisma.notification.createManyAndReturn).toHaveBeenCalledWith({
    data: [
      expect.objectContaining({ userId: "customer-id", type: "BOOKING_EXPIRED" }),
      expect.objectContaining({ userId: "provider-id", type: "BOOKING_EXPIRED" }),
    ],
  });
  expect((await patch(status)).status).toBe(409);
  expect(prisma.booking.update).toHaveBeenCalledTimes(1);
  expect(prisma.notification.createManyAndReturn).toHaveBeenCalledTimes(1);
});

it("does not expire an overdue request through an unauthorized caller", async () => {
  booking.createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
  expect((await patch("CONFIRMED", "customer-id")).status).toBe(403);
  expect(prisma.booking.update).not.toHaveBeenCalled();
  expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
});

it("preserves a confirmed booking after its original response deadline", async () => {
  booking.createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
  booking.bookingStatus = "CONFIRMED";
  expect((await patch("CONFIRMED")).status).toBe(200);
  expect(prisma.booking.update).not.toHaveBeenCalled();
});

it("checks the deadline after acquiring the row lock", async () => {
  booking.createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000 + 1);
  prisma.$queryRaw.mockImplementationOnce(async () => {
    Date.now.mockReturnValue(Date.now() + 1);
  });
  expect((await patch("CONFIRMED")).status).toBe(409);
  expect(booking.bookingStatus).toBe("EXPIRED");
});
