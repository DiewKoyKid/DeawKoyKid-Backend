jest.mock("../src/services/bookingExpiry.service", () => ({ expireUnansweredBookings: jest.fn() }));
const { expireUnansweredBookings } = require("../src/services/bookingExpiry.service");
const { startBookingExpiryJob } = require("../src/jobs/bookingExpiry.job");

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  expireUnansweredBookings.mockResolvedValue(0);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("runs on startup and each minute, and stops when closed", async () => {
  const stop = startBookingExpiryJob();
  expect(expireUnansweredBookings).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(60000);
  expect(expireUnansweredBookings).toHaveBeenCalledTimes(2);
  stop();
  await jest.advanceTimersByTimeAsync(60000);
  expect(expireUnansweredBookings).toHaveBeenCalledTimes(2);
});

it("does not overlap slow sweeps", async () => {
  let finish;
  expireUnansweredBookings.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const stop = startBookingExpiryJob();
  await jest.advanceTimersByTimeAsync(120000);
  expect(expireUnansweredBookings).toHaveBeenCalledTimes(1);
  finish(0);
  await jest.advanceTimersByTimeAsync(60000);
  expect(expireUnansweredBookings).toHaveBeenCalledTimes(2);
  stop();
});

it("logs a failed sweep and retries on the next interval", async () => {
  const error = new Error("database unavailable");
  expireUnansweredBookings.mockRejectedValueOnce(error);
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const stop = startBookingExpiryJob();
  await jest.advanceTimersByTimeAsync(60000);
  expect(log).toHaveBeenCalledWith("booking expiry error:", error);
  expect(expireUnansweredBookings).toHaveBeenCalledTimes(2);
  stop();
});
