const { expireUnansweredBookings } = require("../services/bookingExpiry.service");

// Start only with the HTTP server, not when tests import the Express app.
function startBookingExpiryJob() {
  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try {
      await expireUnansweredBookings();
    } catch (err) {
      console.error("booking expiry error:", err);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(run, 60 * 1000);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}

module.exports = { startBookingExpiryJob };
