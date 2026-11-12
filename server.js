require("dotenv").config();
const app = require("./src/app");
const { startBookingExpiryJob } = require("./src/jobs/bookingExpiry.job");
const { startBookingProgressJob } = require("./src/jobs/bookingProgress.job");

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
const stopBookingExpiryJob = startBookingExpiryJob();
server.once("close", stopBookingExpiryJob);
const stopBookingProgressJob = startBookingProgressJob();
server.once("close", stopBookingProgressJob);
