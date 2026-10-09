const prisma = require("../lib/prisma");

// Every new booking waits for the provider to accept it
const WAITING_FOR_CONFIRMATION = "Waiting for confirmation";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// "YYYY-MM-DD" -> Date at UTC midnight, so @db.Date columns don't shift by a day.
// Returns null for anything that isn't a real calendar date (e.g. 2026-02-30).
function parseDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

// Today's date (server timezone) at UTC midnight, comparable with parseDate results
function today() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

// POST /api/bookings
async function createBooking(req, res) {
  try {
    const { userId } = req.user; // attached by authenticateToken

    const customer = await prisma.customer.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (!customer) {
      return res.status(403).json({ error: "Customer access only." });
    }

    const { serviceId, appointmentDate, duration } = req.body || {};

    if (typeof serviceId !== "string" || serviceId.trim() === "") {
      return res.status(400).json({ error: "serviceId is required" });
    }
    const appointment = parseDate(appointmentDate);
    if (!appointment) {
      return res.status(400).json({ error: "appointmentDate must be a date in YYYY-MM-DD format" });
    }
    const bookedOn = today();
    if (appointment < bookedOn) {
      return res.status(400).json({ error: "appointmentDate cannot be in the past" });
    }
    if (duration !== undefined && duration !== null && (!Number.isInteger(duration) || duration <= 0)) {
      return res.status(400).json({ error: "duration must be a positive integer" });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { providerId: true, isPublished: true },
    });
    if (!service) {
      return res.status(404).json({ error: "Service not found." });
    }
    if (!service.isPublished) {
      return res.status(410).json({ error: "This service is no longer available." });
    }
    // Providers also hold a customer profile, so stop them booking themselves
    if (service.providerId === userId) {
      return res.status(400).json({ error: "You cannot book your own service." });
    }

    const booking = await prisma.booking.create({
      data: {
        serviceId,
        customerId: userId,
        bookingDate: bookedOn,
        appointmentDate: appointment,
        bookingStatus: WAITING_FOR_CONFIRMATION,
        duration: duration ?? null,
      },
      select: {
        id: true,
        serviceId: true,
        customerId: true,
        bookingDate: true,
        appointmentDate: true,
        bookingStatus: true,
        duration: true,
      },
    });

    return res.status(201).json({
      booking: {
        ...booking,
        bookingDate: toDateString(booking.bookingDate),
        appointmentDate: toDateString(booking.appointmentDate),
      },
    });
  } catch (err) {
    console.error("createBooking error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { createBooking };
