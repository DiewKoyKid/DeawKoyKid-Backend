jest.mock("../src/lib/prisma", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  booking: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  notification: { createManyAndReturn: jest.fn() },
}));

const prisma = require("../src/lib/prisma");
const { expireUnansweredBooking, expireUnansweredBookings } = require("../src/services/bookingExpiry.service");

const DAY = 24 * 60 * 60 * 1000;
let booking;
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-19T12:00:00Z"));
  booking = {
    id: "booking-id", customerId: "customer-id", bookingStatus: "WAITING_FOR_CONFIRMATION",
    createdAt: new Date(Date.now() - DAY), appointmentDate: new Date("2026-10-26T00:00:00Z"),
    service: { providerId: "provider-id", title: "Food walk" },
  };
  const { $transaction, ...tx } = prisma;
  prisma.$transaction.mockImplementation((run) => run(tx));
  prisma.booking.findUnique.mockImplementation(async () => booking);
  prisma.booking.update.mockImplementation(async ({ data }) => {
    Object.assign(booking, data);
    const { service, createdAt, ...fields } = booking;
    return fields;
  });
  prisma.notification.createManyAndReturn.mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

it("expires an unanswered request at 24 hours and notifies both parties only once", async () => {
  const result = await expireUnansweredBooking(booking.id);
  expect(result.booking.bookingStatus).toBe("EXPIRED");
  expect(prisma.notification.createManyAndReturn).toHaveBeenCalledWith({
    data: [
      expect.objectContaining({ userId: "customer-id", type: "BOOKING_EXPIRED" }),
      expect.objectContaining({ userId: "provider-id", type: "BOOKING_EXPIRED" }),
    ],
  });
  expect(await expireUnansweredBooking(booking.id)).toBeNull();
  expect(prisma.booking.update).toHaveBeenCalledTimes(1);
  expect(prisma.notification.createManyAndReturn).toHaveBeenCalledTimes(1);
});

it("keeps a request open one millisecond before its deadline", async () => {
  booking.createdAt = new Date(Date.now() - DAY + 1);
  expect(await expireUnansweredBooking(booking.id)).toBeNull();
  expect(prisma.booking.update).not.toHaveBeenCalled();
});

it.each(["CONFIRMED", "REJECTED", "CANCELLED", "COMPLETED", "EXPIRED"])("preserves an old %s booking", async (status) => {
  booking.bookingStatus = status;
  booking.createdAt = new Date(Date.now() - 7 * DAY);
  expect(await expireUnansweredBooking(booking.id)).toBeNull();
  expect(prisma.booking.update).not.toHaveBeenCalled();
  expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
});

it("ignores a deleted candidate", async () => {
  prisma.booking.findUnique.mockResolvedValue(null);
  expect(await expireUnansweredBooking("missing")).toBeNull();
  expect(prisma.booking.update).not.toHaveBeenCalled();
});

it("rechecks the status after waiting for a competing provider decision", async () => {
  prisma.$queryRaw.mockImplementationOnce(async () => { booking.bookingStatus = "CONFIRMED"; });
  expect(await expireUnansweredBooking(booking.id)).toBeNull();
  expect(prisma.booking.update).not.toHaveBeenCalled();
});

it("propagates notification failure to abort the expiry transaction", async () => {
  prisma.notification.createManyAndReturn.mockRejectedValue(new Error("notification failed"));
  await expect(expireUnansweredBooking(booking.id)).rejects.toThrow("notification failed");
});

it("scans overdue waiting requests in bounded pages", async () => {
  const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: `booking-${i}` }));
  prisma.booking.findMany.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([{ id: "last-booking" }]);
  prisma.$transaction.mockResolvedValue({ booking: { bookingStatus: "EXPIRED" } });
  expect(await expireUnansweredBookings()).toBe(101);
  expect(prisma.booking.findMany).toHaveBeenNthCalledWith(1, {
    where: { bookingStatus: "WAITING_FOR_CONFIRMATION", createdAt: { lte: new Date(Date.now() - DAY) } },
    select: { id: true }, orderBy: { id: "asc" }, take: 100,
  });
  expect(prisma.booking.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
    where: {
      bookingStatus: "WAITING_FOR_CONFIRMATION", createdAt: { lte: new Date(Date.now() - DAY) },
      id: { gt: "booking-99" },
    },
  }));
});

it("handles an empty sweep without starting a transaction", async () => {
  prisma.booking.findMany.mockResolvedValue([]);
  expect(await expireUnansweredBookings()).toBe(0);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
