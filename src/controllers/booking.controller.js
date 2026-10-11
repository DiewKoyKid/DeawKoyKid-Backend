const prisma = require("../lib/prisma");
const { notifyProviderOfNewBooking } = require("../services/notification.service");

// Every new booking waits for the provider to accept it
const WAITING_FOR_CONFIRMATION = "Waiting for confirmation";

// Bookings in these statuses no longer hold their slot. Matched loosely because
// the status values aren't finalised yet (seed data uses "CANCELLED"/"COMPLETED").
const RELEASED_STATUSES = ["Rejected", "Expired", "Cancelled", "CANCELLED"];

// US6-1: one message for both a taken slot and a past date
const SLOT_UNAVAILABLE = "This time slot is not available";

class SlotTakenError extends Error {}

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
      select: { user: { select: { firstname: true, lastname: true } } },
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
      return res.status(400).json({ error: SLOT_UNAVAILABLE });
    }
    if (duration !== undefined && duration !== null && (!Number.isInteger(duration) || duration <= 0)) {
      return res.status(400).json({ error: "duration must be a positive integer" });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { title: true, providerId: true, isPublished: true },
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

    let booking;
    try {
      booking = await prisma.$transaction(async (tx) => {
        // Lock the service row so concurrent requests for it queue here: the
        // slot check and insert below then can't interleave with another
        // customer's, and two people can't both take the same date.
        await tx.$queryRaw`SELECT 1 FROM "services" WHERE "id" = ${serviceId} FOR UPDATE`;

        const taken = await tx.booking.findFirst({
          where: { serviceId, appointmentDate: appointment, bookingStatus: { notIn: RELEASED_STATUSES } },
          select: { id: true },
        });
        if (taken) throw new SlotTakenError();

        const created = await tx.booking.create({
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

        // Same transaction, so a rolled-back booking leaves no notification behind
        await notifyProviderOfNewBooking(tx, {
          booking: created,
          providerId: service.providerId,
          serviceTitle: service.title,
          customerName: `${customer.user.firstname} ${customer.user.lastname}`,
        });

        return created;
      });
    } catch (err) {
      if (err instanceof SlotTakenError) {
        return res.status(409).json({ error: SLOT_UNAVAILABLE });
      }
      throw err;
    }

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
