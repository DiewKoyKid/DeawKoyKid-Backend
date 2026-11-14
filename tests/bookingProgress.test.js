// US6-5: the job that moves confirmed bookings to IN_PROGRESS at their start
// time. Runs without PostgreSQL, like bookingExpiry.test.js.
jest.mock("../src/lib/prisma", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  booking: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  notification: { createManyAndReturn: jest.fn() },
}));

const prisma = require("../src/lib/prisma");
const { startConfirmedBooking, startConfirmedBookings } = require("../src/services/bookingProgress.service");

// Local time, matching how bookingStartsAt reads the appointment date
const NOW = new Date(2026, 9, 20, 12, 0);

let booking;
beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(NOW.getTime());
  booking = {
    id: "booking-id", customerId: "customer-id", bookingStatus: "CONFIRMED",
    appointmentDate: new Date("2026-10-20T00:00:00Z"), startTime: "09:00", endTime: "13:00",
    service: { providerId: "provider-id", title: "Food walk" },
  };
  const { $transaction, ...tx } = prisma;
  prisma.$transaction.mockImplementation((run) => run(tx));
  prisma.booking.findUnique.mockImplementation(async () => booking);
  prisma.booking.update.mockImplementation(async ({ data }) => {
    Object.assign(booking, data);
    const { service, ...fields } = booking;
    return fields;
  });
  prisma.notification.createManyAndReturn.mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

it("moves a confirmed booking that has started to IN_PROGRESS without notifying anyone", async () => {
  const result = await startConfirmedBooking(booking.id);
  expect(result.booking.bookingStatus).toBe("IN_PROGRESS");
  expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
  // Running again does nothing
  expect(await startConfirmedBooking(booking.id)).toBeNull();
  expect(prisma.booking.update).toHaveBeenCalledTimes(1);
});

it.each([
  ["a slot later today", "2026-10-20T00:00:00Z", "12:01", false],
  ["a slot starting exactly now", "2026-10-20T00:00:00Z", "12:00", true],
  ["a whole-day booking today", "2026-10-20T00:00:00Z", null, true],
  ["a whole-day booking tomorrow", "2026-10-21T00:00:00Z", null, false],
])("handles %s", async (_, appointmentDate, startTime, moves) => {
  Object.assign(booking, { appointmentDate: new Date(appointmentDate), startTime });
  const result = await startConfirmedBooking(booking.id);
  expect(result === null).toBe(!moves);
});

it.each(["WAITING_FOR_CONFIRMATION", "REJECTED", "EXPIRED", "CANCELLED", "COMPLETED", "IN_PROGRESS"])(
  "leaves a %s booking alone", async (status) => {
    booking.bookingStatus = status;
    expect(await startConfirmedBooking(booking.id)).toBeNull();
    expect(prisma.booking.update).not.toHaveBeenCalled();
  });

it("sweeps only confirmed bookings up to today, and skips ones that haven't started", async () => {
  const later = { id: "b-later", appointmentDate: new Date("2026-10-20T00:00:00Z"), startTime: "15:00" };
  const started = { id: "b-started", appointmentDate: new Date("2026-10-20T00:00:00Z"), startTime: "08:00" };
  prisma.booking.findMany.mockResolvedValueOnce([started, later]);

  expect(await startConfirmedBookings()).toBe(1);
  expect(prisma.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { bookingStatus: "CONFIRMED", appointmentDate: { lte: new Date("2026-10-20T00:00:00Z") } },
  }));
  // Only the booking that has started is looked at (startConfirmedBooking and
  // changeBookingStatus each read it once); the later one is never touched.
  const lookedUp = prisma.booking.findUnique.mock.calls.map(([args]) => args.where.id);
  expect(lookedUp).toContain("b-started");
  expect(lookedUp).not.toContain("b-later");
});
