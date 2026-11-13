// Unit test for the 24-hour expiry rule (F48), for the test plan's coverage demo.
// Pure function: no database, no app. Run with `npm run test:unit:coverage`.
const { isUnansweredBookingExpired } = require("../../src/utils/bookingStatus");

const now = Date.parse("2026-11-17T12:00:00Z");

function booking(bookingStatus, createdAt) {
  return { bookingStatus, createdAt: new Date(createdAt) };
}

describe("isUnansweredBookingExpired(booking, now)", () => {
  it("UT01: a waiting request made 25 hours ago has expired", () => {
    expect(isUnansweredBookingExpired(booking("WAITING_FOR_CONFIRMATION", "2026-11-16T11:00:00Z"), now)).toBe(true);
  });

  it("UT02: a waiting request made 1 hour ago hasn't expired", () => {
    expect(isUnansweredBookingExpired(booking("WAITING_FOR_CONFIRMATION", "2026-11-17T11:00:00Z"), now)).toBe(false);
  });

  it("UT03: a waiting request made exactly 24 hours ago has expired", () => {
    expect(isUnansweredBookingExpired(booking("WAITING_FOR_CONFIRMATION", "2026-11-16T12:00:00Z"), now)).toBe(true);
  });

  it("UT04: a confirmed booking never expires, however old", () => {
    expect(isUnansweredBookingExpired(booking("CONFIRMED", "2026-11-16T11:00:00Z"), now)).toBe(false);
  });
});
