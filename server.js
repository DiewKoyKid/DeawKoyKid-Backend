require("dotenv").config();
if (process.env.NODE_ENV === "production") {
  for (const key of ["DATABASE_URL", "JWT_SECRET", "CORS_ORIGIN", "FRONTEND_URL", "SMTP_HOST"]) {
    if (!process.env[key]) throw new Error("Missing required environment variable: " + key);
  }
}
const app = require("./src/app");
const prisma = require("./src/lib/prisma");
const { startBookingExpiryJob } = require("./src/jobs/bookingExpiry.job");
const { startBookingProgressJob } = require("./src/jobs/bookingProgress.job");
const { attachChat } = require("./src/socket/chat.socket");
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, "0.0.0.0", () => console.log("Server listening on port " + PORT));
const io = attachChat(server);
app.set("chatIo", io);
const inlineExpiry = process.env.BOOKING_EXPIRY_INLINE === "true" ||
  (process.env.NODE_ENV !== "production" && process.env.BOOKING_EXPIRY_INLINE !== "false");
const stopExpiry = inlineExpiry ? startBookingExpiryJob() : () => {};
const inlineProgress = process.env.BOOKING_PROGRESS_INLINE === "true" ||
  (process.env.NODE_ENV !== "production" && process.env.BOOKING_PROGRESS_INLINE !== "false");
const stopProgress = inlineProgress ? startBookingProgressJob() : () => {};
server.once("close", () => { stopExpiry(); stopProgress(); });
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  stopExpiry();
  stopProgress();
  const deadline = setTimeout(() => process.exit(1), 9000);
  deadline.unref();
  // Socket.IO closes its clients and the underlying HTTP server.
  io.close(async () => {
    try { await prisma.$disconnect(); }
    catch { process.exitCode = 1; }
    finally { clearTimeout(deadline); }
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
