// Route-level checks for PATCH /api/bookings/:id/complete (US6-5) that run
// without PostgreSQL, in the same style as bookingCancel.test.js.
process.env.JWT_SECRET = "booking-complete-test-secret";

jest.mock("../src/lib/prisma", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  user: { findUnique: jest.fn() },
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

// Local time, matching how the controller reads the appointment date
const NOW = new Date(2026, 9, 20, 12, 0);

let booking;
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(NOW.getTime());
  // A 09:00-11:00 trip this morning, so it has ended
  booking = {
    id: "booking-id", serviceId: "service-id", customerId: "customer-id",
    bookingDate: new Date("2026-10-15T00:00:00Z"),
    createdAt: new Date("2026-10-15T08:00:00Z"),
    appointmentDate: new Date("2026-10-20T00:00:00Z"),
    bookingStatus: "IN_PROGRESS", totalPrice: "900.00",
    duration: null, startTime: "09:00", endTime: "11:00",
    service: { providerId: "provider-id", title: "Food walk" },
  };
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

function complete(actor = "customer-id") {
  const req = request(app).patch("/api/bookings/booking-id/complete");
  if (actor) req.set("Authorization", `Bearer ${signToken({ userId: actor })}`);
  return req.send();
}

it("requires a valid token", async () => {
  expect((await complete(null)).status).toBe(401);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it.each(["IN_PROGRESS", "CONFIRMED"])("completes an ended %s booking and notifies only the provider", async (status) => {
  booking.bookingStatus = status;
  const res = await complete();
  expect(res.status).toBe(200);
  expect(res.body.booking).toMatchObject({
    id: booking.id, bookingStatus: "COMPLETED", totalPrice: 900,
    bookingDate: "2026-10-15", appointmentDate: "2026-10-20",
  });
  expect(prisma.booking.update).toHaveBeenCalledWith(expect.objectContaining({ data: { bookingStatus: "COMPLETED" } }));
  expect(prisma.notification.createManyAndReturn).toHaveBeenCalledWith({
    data: [expect.objectContaining({ userId: "provider-id", bookingId: booking.id, type: "BOOKING_COMPLETED" })],
  });
});

it.each(["provider-id", "another-customer-id"])("forbids %s without writing anything", async (actor) => {
  expect((await complete(actor)).status).toBe(403);
  expect(prisma.booking.update).not.toHaveBeenCalled();
  expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
});

it("returns 404 for an unknown booking", async () => {
  prisma.booking.findUnique.mockResolvedValue(null);
  expect((await complete()).status).toBe(404);
});

it.each(["WAITING_FOR_CONFIRMATION", "REJECTED", "EXPIRED", "CANCELLED"])("does not complete a %s booking", async (status) => {
  booking.bookingStatus = status;
  const res = await complete();
  expect(res.status).toBe(409);
  expect(res.body.error).toBe("Only a confirmed booking can be completed.");
  expect(prisma.booking.update).not.toHaveBeenCalled();
});

it("refuses to complete a booking twice", async () => {
  booking.bookingStatus = "COMPLETED";
  const res = await complete();
  expect(res.status).toBe(409);
  expect(res.body.error).toBe("This booking is already completed.");
  expect(prisma.booking.update).not.toHaveBeenCalled();
  expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
});

it.each([
  // [what, appointmentDate, startTime, endTime, expected status]
  ["a slot that ended this morning", "2026-10-20T00:00:00Z", "09:00", "11:00", 200],
  ["a slot that ends exactly now", "2026-10-20T00:00:00Z", "10:00", "12:00", 200],
  ["a slot that ends in a minute", "2026-10-20T00:00:00Z", "10:00", "12:01", 409],
  ["a slot still going on", "2026-10-20T00:00:00Z", "11:00", "15:00", 409],
  ["a slot later today", "2026-10-20T00:00:00Z", "14:00", "16:00", 409],
  ["a slot yesterday", "2026-10-19T00:00:00Z", "14:00", "16:00", 200],
  ["a whole-day booking today", "2026-10-20T00:00:00Z", null, null, 409],
  ["a whole-day booking yesterday", "2026-10-19T00:00:00Z", null, null, 200],
])("handles %s", async (_, appointmentDate, startTime, endTime, expected) => {
  Object.assign(booking, { appointmentDate: new Date(appointmentDate), startTime, endTime });
  const res = await complete();
  expect(res.status).toBe(expected);
  if (expected === 409) {
    expect(res.body.error).toBe("You can confirm completion only after the booking has ended.");
    expect(prisma.booking.update).not.toHaveBeenCalled();
  }
});

it("returns a generic server error if the transaction fails", async () => {
  prisma.$transaction.mockRejectedValue(new Error("private database error"));
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const res = await complete();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  } finally {
    log.mockRestore();
  }
});
