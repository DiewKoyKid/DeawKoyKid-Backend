const { startConfirmedBookings } = require("../services/bookingProgress.service");

// US6-5: once a minute, moves confirmed bookings whose start time has passed
// to IN_PROGRESS. Start only with the HTTP server, not when tests import the app.
function startBookingProgressJob() {
  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try {
      await startConfirmedBookings();
    } catch (err) {
      console.error("booking progress error:", err);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(run, 60 * 1000);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}

module.exports = { startBookingProgressJob };
