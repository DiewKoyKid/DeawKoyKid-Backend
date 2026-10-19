const prisma = require("../lib/prisma");
const { notifyProviderOfNewBooking } = require("../services/notification.service");
const { changeBookingStatus } = require("../services/booking.service");
const { BookingStatus, SLOT_HOLDING_STATUSES, isUnansweredBookingExpired } = require("../utils/bookingStatus");

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
function minutesOf(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function priceFor(service, startTime, endTime) {
  const rate = Number(service.rate);
  if (service.rateUnit === "day") return rate;
  if (!startTime || !endTime) return null;
  const hours = (minutesOf(endTime) - minutesOf(startTime)) / 60;
  return Math.round(rate * hours * 100) / 100;
}

function clashingBookingsWhere(serviceId, date, startTime, endTime) {
  const where = { serviceId, appointmentDate: date, bookingStatus: { in: SLOT_HOLDING_STATUSES } };
  if (!startTime) return where;
  return {
    ...where,
    OR: [{ startTime: null }, { startTime: { lt: endTime }, endTime: { gt: startTime } }],
  };
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

    const { serviceId, slotId, appointmentDate, duration } = req.body || {};

    if (typeof serviceId !== "string" || serviceId.trim() === "") {
      return res.status(400).json({ error: "serviceId is required" });
    }
        if (slotId !== undefined && slotId !== null && (typeof slotId !== "string" || slotId.trim() === "")) {
      return res.status(400).json({ error: "slotId must be a string" });
    }
    let appointment = null;
    if (!slotId) {
      appointment = parseDate(appointmentDate);
      if (!appointment) {
        return res.status(400).json({ error: "appointmentDate must be a date in YYYY-MM-DD format" });
      }
    }
    const bookedOn = today();
    if (appointment && appointment < bookedOn) {
      return res.status(400).json({ error: SLOT_UNAVAILABLE });
    }
    if (duration !== undefined && duration !== null && (!Number.isInteger(duration) || duration <= 0)) {
      return res.status(400).json({ error: "duration must be a positive integer" });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { title: true, providerId: true, isPublished: true, rate: true, rateUnit: true },
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

        let startTime = null;
        let endTime = null;
        if (slotId) {
          const slot = await tx.availabilitySlot.findFirst({
            where: { id: slotId, serviceId },
            select: { date: true, startTime: true, endTime: true },
          });
          if (!slot || slot.date < bookedOn) throw new SlotTakenError();
          appointment = slot.date;
          startTime = slot.startTime;
          endTime = slot.endTime;
        }

        const taken = await tx.booking.findFirst({
          where: clashingBookingsWhere(serviceId, appointment, startTime, endTime),
          select: { id: true },
        });
        if (taken) throw new SlotTakenError();

        const created = await tx.booking.create({
          data: {
            serviceId,
            customerId: userId,
            bookingDate: bookedOn,
            appointmentDate: appointment,
            startTime,                                       
            endTime,
            bookingStatus: BookingStatus.WAITING_FOR_CONFIRMATION,
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
            startTime: true,
            endTime: true,
            totalPrice: true,
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
        totalPrice: booking.totalPrice === null ? null : Number(booking.totalPrice),
      },
    });
  } catch (err) {
    console.error("createBooking error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// PATCH /api/bookings/:id/status — the service owner accepts or rejects a request.
async function updateBookingStatus(req, res) {
  const { status } = req.body || {};
  if (![BookingStatus.CONFIRMED, BookingStatus.REJECTED].includes(status)) {
    return res.status(400).json({ error: "status must be CONFIRMED or REJECTED" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Hold this lock through authorization, transition validation, and the
      // status-change hook so concurrent decisions cannot overwrite each other.
      await tx.$queryRaw`SELECT 1 FROM "bookings" WHERE "id" = ${req.params.id} FOR UPDATE`;
      const current = await tx.booking.findUnique({
        where: { id: req.params.id },
        select: { bookingStatus: true, createdAt: true, service: { select: { providerId: true } } },
      });
      if (!current) {
        return { statusCode: 404, error: "Booking not found." };
      }
      if (current.service.providerId !== req.user.userId) {
        return { statusCode: 403, error: "Only the service provider can change the booking status." };
      }
      if (isUnansweredBookingExpired(current)) {
        // Expiry is a system action: notify both parties, and commit it before
        // returning the conflict response (throwing would roll it back).
        await changeBookingStatus(req.params.id, BookingStatus.EXPIRED, { client: tx });
        return { statusCode: 409, error: "This request has expired" };
      }
      if (current.bookingStatus === BookingStatus.EXPIRED) {
        return { statusCode: 409, error: "This request has expired" };
      }
      // Retrying the same decision is harmless; the hook suppresses duplicate
      // notifications. All other decisions require a waiting request.
      if (current.bookingStatus !== BookingStatus.WAITING_FOR_CONFIRMATION && current.bookingStatus !== status) {
        return { statusCode: 409, error: "Only a booking waiting for confirmation can be confirmed or rejected." };
      }

      return changeBookingStatus(req.params.id, status, { actorId: req.user.userId, client: tx });
    });

    if (result.error) return res.status(result.statusCode).json({ error: result.error });
    const { booking } = result;
    return res.status(200).json({
      booking: {
        ...booking,
        bookingDate: toDateString(booking.bookingDate),
        appointmentDate: toDateString(booking.appointmentDate),
        totalPrice: booking.totalPrice === null ? null : Number(booking.totalPrice),
      },
    });
  } catch (err) {
    console.error("updateBookingStatus error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { createBooking, updateBookingStatus };
