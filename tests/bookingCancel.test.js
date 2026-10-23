// Route-level checks for PATCH /api/bookings/:id/cancel that run without
// PostgreSQL, in the same style as bookingStatus.test.js.
process.env.JWT_SECRET = "booking-cancel-test-secret";

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
  booking = {
    id: "booking-id", serviceId: "service-id", customerId: "customer-id",
    bookingDate: new Date("2026-10-19T00:00:00Z"),
    createdAt: new Date("2026-10-19T08:00:00Z"),
    appointmentDate: new Date("2026-10-26T00:00:00Z"),
    bookingStatus: "CONFIRMED", totalPrice: "450.00",
    duration: null, startTime: null, endTime: null,
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

function cancel(actor = "customer-id") {
  const req = request(app).patch("/api/bookings/booking-id/cancel");
  if (actor) req.set("Authorization", `Bearer ${signToken({ userId: actor })}`);
  return req.send();
}

it("requires a valid token", async () => {
  expect((await cancel(null)).status).toBe(401);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it("lets the customer cancel a confirmed booking and notifies only the provider", async () => {
  const res = await cancel();
  expect(res.status).toBe(200);
  expect(res.body.booking).toMatchObject({
    id: booking.id, bookingStatus: "CANCELLED", totalPrice: 450,
    bookingDate: "2026-10-19", appointmentDate: "2026-10-26",
  });
  expect(prisma.notification.createManyAndReturn).toHaveBeenCalledWith({
    data: [expect.objectContaining({ userId: "provider-id", bookingId: booking.id, type: "BOOKING_CANCELLED" })],
  });
});

it.each(["provider-id", "another-customer-id"])("forbids %s without writing anything", async (actor) => {
  expect((await cancel(actor)).status).toBe(403);
  expect(prisma.booking.update).not.toHaveBeenCalled();
  expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
});

it("returns 404 for an unknown booking", async () => {
  prisma.booking.findUnique.mockResolvedValue(null);
  expect((await cancel()).status).toBe(404);
});

it.each(["WAITING_FOR_CONFIRMATION", "REJECTED", "EXPIRED", "COMPLETED"])("does not cancel a %s booking", async (status) => {
  booking.bookingStatus = status;
  const res = await cancel();
  expect(res.status).toBe(409);
  expect(res.body.error).toBe("Only a confirmed booking can be cancelled.");
  expect(prisma.booking.update).not.toHaveBeenCalled();
});

it("returns an already cancelled booking without writing or notifying again", async () => {
  booking.bookingStatus = "CANCELLED";
  const res = await cancel();
  expect(res.status).toBe(200);
  expect(res.body.booking.bookingStatus).toBe("CANCELLED");
  expect(prisma.booking.update).not.toHaveBeenCalled();
  expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
});

it.each([
  ["a day booking on its date", "2026-10-20T00:00:00Z", null, 409],
  ["a past day booking", "2026-10-19T00:00:00Z", null, 409],
  ["a day booking tomorrow", "2026-10-21T00:00:00Z", null, 200],
  ["a slot that started at noon", "2026-10-20T00:00:00Z", "12:00", 409],
  ["a slot earlier today", "2026-10-20T00:00:00Z", "09:00", 409],
  ["a slot later today", "2026-10-20T00:00:00Z", "12:01", 200],
])("handles %s", async (_, appointmentDate, startTime, expected) => {
  booking.appointmentDate = new Date(appointmentDate);
  booking.startTime = startTime;
  const res = await cancel();
  expect(res.status).toBe(expected);
  if (expected === 409) {
    expect(res.body.error).toBe("This booking has already started and can no longer be cancelled.");
    expect(prisma.booking.update).not.toHaveBeenCalled();
  }
});

it("returns a generic server error if the transaction fails", async () => {
  prisma.$transaction.mockRejectedValue(new Error("private database error"));
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const res = await cancel();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  } finally {
    log.mockRestore();
  }
});
