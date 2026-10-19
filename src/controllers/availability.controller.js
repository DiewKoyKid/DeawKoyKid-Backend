const prisma = require("../lib/prisma");
const { BookingStatus } = require("../utils/bookingStatus");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function overlaps(first, second) {
  return (
    first.date.getTime() === second.date.getTime() &&
    timeToMinutes(first.startTime) < timeToMinutes(second.endTime) &&
    timeToMinutes(second.startTime) < timeToMinutes(first.endTime)
  );
}

function conflict(res) {
  return res.status(409).json({ error: "Availability slots overlap or already exist." });
}

function parseSlots(slots) {
  if (!Array.isArray(slots)) {
    return { error: "slots must be an array." };
  }

  const parsedSlots = [];
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const date = parseDate(slot?.date);
    if (!date) {
      return { error: `slots[${index}].date must be a valid YYYY-MM-DD date.` };
    }
    if (typeof slot.startTime !== "string" || !TIME_PATTERN.test(slot.startTime)) {
      return { error: `slots[${index}].startTime must be a valid HH:MM time.` };
    }
    if (typeof slot.endTime !== "string" || !TIME_PATTERN.test(slot.endTime)) {
      return { error: `slots[${index}].endTime must be a valid HH:MM time.` };
    }
    if (slot.endTime <= slot.startTime) {
      return { error: `slots[${index}].endTime must be after startTime.` };
    }
    parsedSlots.push({ date, startTime: slot.startTime, endTime: slot.endTime });
  }

  for (let index = 0; index < parsedSlots.length; index += 1) {
    if (parsedSlots.slice(0, index).some((slot) => overlaps(slot, parsedSlots[index]))) {
      return { conflict: true };
    }
  }

  return { parsedSlots };
}

async function getOwnedService(req, res) {
  const service = await prisma.service.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      providerId: true,
      rateUnit: true,
      startTime: true,
      endTime: true,
    },
  });
  if (!service) {
    res.status(404).json({ error: "Service not found." });
    return null;
  }
  if (service.providerId !== req.user.userId) {
    res.status(403).json({ error: "Only the service provider can manage availability." });
    return null;
  }
  return service;
}

function formatSlots(slots) {
  return slots
    .map((slot) => ({
      ...slot,
      date: slot.date.toISOString().slice(0, 10),
    }))
    .sort((first, second) =>
      `${first.date}T${first.startTime}`.localeCompare(`${second.date}T${second.startTime}`)
    );
}

function hourSlotsFor(startTime, endTime) {
  const startHour = Number(startTime.slice(0, 2));
  const endHour = Number(endTime.slice(0, 2));
  return Array.from({ length: endHour - startHour }, (_, index) => {
    const hour = startHour + index;
    return {
      startTime: `${String(hour).padStart(2, "0")}:00`,
      endTime: `${String(hour + 1).padStart(2, "0")}:00`,
    };
  });
}

async function readServiceAvailability(service) {
  const [slots, bookings] = await Promise.all([
    prisma.availabilitySlot.findMany({
      where: { serviceId: service.id },
      select: { date: true, startTime: true, endTime: true },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    }),
    prisma.booking.findMany({
      where: {
        serviceId: service.id,
        bookingStatus: { in: [BookingStatus.WAITING_FOR_CONFIRMATION, BookingStatus.CONFIRMED] },
      },
      select: { appointmentDate: true, startTime: true, endTime: true },
    }),
  ]);

  if ((service.rateUnit || "hour") === "day") {
    const dates = (rows, getDate) => [...new Set(rows.map((row) => getDate(row).toISOString().slice(0, 10)))];
    return {
      openDates: dates(slots, (slot) => slot.date),
      bookedDates: dates(bookings, (booking) => booking.appointmentDate),
    };
  }

  const hours = hourSlotsFor(service.startTime, service.endTime);
  const toHourMap = (rows, getDate, matchesHour) => {
    const result = {};
    rows.forEach((row) => {
      const date = getDate(row).toISOString().slice(0, 10);
      const openHours = hours.filter((hour) => matchesHour(row, hour)).map((hour) => hour.startTime);
      if (openHours.length) result[date] = [...new Set([...(result[date] || []), ...openHours])].sort();
    });
    return result;
  };
  const coversHour = (slot, hour) =>
    slot.startTime <= hour.startTime && slot.endTime >= hour.endTime;
  const overlapsHour = (booking, hour) =>
    booking.startTime === null ||
    (booking.startTime < hour.endTime && booking.endTime > hour.startTime);

  return {
    openSlots: toHourMap(slots, (slot) => slot.date, coversHour),
    bookedSlots: toHourMap(bookings, (booking) => booking.appointmentDate, overlapsHour),
  };
}

// GET /api/providers/me/services/:id/availability
async function getMyServiceAvailability(req, res) {
  try {
    const service = await getOwnedService(req, res);
    if (!service) return;
    if (!service.startTime || !service.endTime) {
      return res.status(400).json({ error: "Service hours must be set before availability can be managed." });
    }
    return res.status(200).json(await readServiceAvailability(service));
  } catch (err) {
    console.error("getMyServiceAvailability error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

function availabilitySlotsFromBody(service, body) {
  if ((service.rateUnit || "hour") === "day") {
    if (!Array.isArray(body.openDates)) {
      return { error: "openDates must be an array." };
    }
    if (!service.startTime || !service.endTime) {
      return { error: "Service hours must be set before availability can be managed." };
    }
    return {
      slots: body.openDates.map((date) => ({
        date,
        startTime: service.startTime,
        endTime: service.endTime,
      })),
    };
  }

  if (!body.openSlots || typeof body.openSlots !== "object" || Array.isArray(body.openSlots)) {
    return { error: "openSlots must be an object of dates and hours." };
  }
  if (!service.startTime || !service.endTime) {
    return { error: "Service hours must be set before availability can be managed." };
  }
  const allowedHours = new Set(hourSlotsFor(service.startTime, service.endTime).map((hour) => hour.startTime));
  const slots = [];
  for (const [date, openHours] of Object.entries(body.openSlots)) {
    if (!Array.isArray(openHours)) {
      return { error: `openSlots.${date} must be an array.` };
    }
    for (const startTime of openHours) {
      if (typeof startTime !== "string" || !allowedHours.has(startTime)) {
        return { error: `openSlots.${date} contains an hour outside the service hours.` };
      }
      const hour = hourSlotsFor(startTime, `${String(Number(startTime.slice(0, 2)) + 1).padStart(2, "0")}:00`)[0];
      slots.push({ date, ...hour });
    }
  }
  return { slots };
}

async function replaceServiceSlots(service, replacementSlots) {
  const replacementDates = new Set(replacementSlots.map((slot) => slot.date.toISOString()));
  return prisma.$transaction(
    async (transaction) => {
      const confirmedBookings = await transaction.booking.findMany({
        where: {
          serviceId: service.id,
          bookingStatus: BookingStatus.CONFIRMED,
        },
        select: { appointmentDate: true },
      });
      if (confirmedBookings.some((booking) => !replacementDates.has(booking.appointmentDate.toISOString()))) {
        return { blockedByBooking: true, slots: [] };
      }

      await transaction.availabilitySlot.deleteMany({ where: { serviceId: service.id } });
      const created =
        replacementSlots.length > 0
          ? await transaction.availabilitySlot.createManyAndReturn({
              data: replacementSlots.map((slot) => ({ ...slot, serviceId: service.id })),
              select: { id: true, date: true, startTime: true, endTime: true },
            })
          : [];
      return { blockedByBooking: false, slots: created };
    },
    { isolationLevel: "Serializable" }
  );
}

// PUT /api/providers/me/services/:id/availability
async function updateMyServiceAvailability(req, res) {
  try {
    const service = await getOwnedService(req, res);
    if (!service) return;

    const converted = availabilitySlotsFromBody(service, req.body || {});
    if (converted.error) return res.status(400).json({ error: converted.error });
    const parsed = parseSlots(converted.slots);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.conflict) return conflict(res);

    const result = await replaceServiceSlots(service, parsed.parsedSlots);
    if (result.blockedByBooking) {
      return res.status(409).json({
        error: "Availability cannot remove a date with a confirmed booking.",
      });
    }

    return res.status(200).json(await readServiceAvailability(service));
  } catch (err) {
    if (err.code === "P2004" || err.code === "P2002" || err.code === "P2034") {
      return conflict(res);
    }
    console.error("updateMyServiceAvailability error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// POST /api/services/:id/availability
async function addAvailability(req, res) {
  try {
    const service = await getOwnedService(req, res);
    if (!service) return;

    const { slots } = req.body || {};
    if (!Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({ error: "slots must be a non-empty array." });
    }

    const parsed = parseSlots(slots);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.conflict) return conflict(res);
    const parsedSlots = parsed.parsedSlots.map((slot) => ({ ...slot, serviceId: service.id }));

    const dates = [...new Map(parsedSlots.map((slot) => [slot.date.toISOString(), slot.date])).values()];
    const existingSlots = await prisma.availabilitySlot.findMany({
      where: { serviceId: service.id, date: { in: dates } },
      select: { date: true, startTime: true, endTime: true },
    });
    if (parsedSlots.some((slot) => existingSlots.some((existing) => overlaps(slot, existing)))) {
      return conflict(res);
    }

    const created = await prisma.availabilitySlot.createManyAndReturn({
      data: parsedSlots,
      select: { id: true, date: true, startTime: true, endTime: true },
    });

    return res.status(201).json({ slots: formatSlots(created) });
  } catch (err) {
    if (err.code === "P2004" || err.code === "P2002") {
      return conflict(res);
    }
    console.error("addAvailability error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// PUT /api/services/:id/availability
async function replaceAvailability(req, res) {
  try {
    const service = await getOwnedService(req, res);
    if (!service) return;

    const { slots } = req.body || {};
    if (!Array.isArray(slots)) {
      return res.status(400).json({ error: "slots must be an array." });
    }

    const parsed = parseSlots(slots);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.conflict) return conflict(res);
    const replacementSlots = parsed.parsedSlots.map((slot) => ({ ...slot, serviceId: service.id }));
    const result = await replaceServiceSlots(service, replacementSlots);

    if (result.blockedByBooking) {
      return res.status(409).json({
        error: "Availability cannot remove a date with a confirmed booking.",
      });
    }
    return res.status(200).json({ slots: formatSlots(result.slots) });
  } catch (err) {
    if (err.code === "P2004" || err.code === "P2002" || err.code === "P2034") {
      return conflict(res);
    }
    console.error("replaceAvailability error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  addAvailability,
  replaceAvailability,
  getMyServiceAvailability,
  updateMyServiceAvailability,
};
