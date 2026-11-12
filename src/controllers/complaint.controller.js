const { ComplaintCategory } = require("@prisma/client");
const prisma = require("../lib/prisma");
const {
  badRequest, validateAttachment, persistAttachments, cleanupAttachments,
} = require("../utils/complaintAttachments");

// authenticateToken intentionally permits a token whose user no longer exists.
// Reject that case here before accepting files, without changing other routes.
async function requireComplaintUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { deletedAt: true } });
    if (!user || user.deletedAt) return res.status(401).json({ error: "Account is unavailable" });
    return next();
  } catch (err) {
    console.error("Complaint user lookup error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

function validateFields(body = {}) {
  const allowed = ["bookingId", "category", "subject", "description"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw badRequest("Unexpected form field");
  const result = {};
  for (const field of allowed) {
    if (typeof body[field] !== "string" || !body[field].trim()) throw badRequest(`${field} is required and must be a string`);
    result[field] = body[field].trim();
  }
  for (const [field, max] of [["subject", 100], ["description", 2000]]) {
    if ([...result[field]].length > max) throw badRequest(`${field} must be at most ${max} characters`);
  }
  if (!Object.values(ComplaintCategory).includes(result.category)) throw badRequest("category is invalid");
  return result;
}

async function createComplaint(req, res) {
  let committed = false;
  let status = 201;
  let response;
  try {
    const fields = validateFields(req.body);
    const booking = await prisma.booking.findUnique({ where: { id: fields.bookingId }, select: { customerId: true } });
    if (!booking) throw Object.assign(new Error("Booking not found"), { status: 404 });
    if (booking.customerId !== req.user.userId) {
      throw Object.assign(new Error("You can only complain about your own bookings"), { status: 403 });
    }
    for (const file of req.files || []) await validateAttachment(file);
    const attachments = await persistAttachments(req);
    // A nested create is atomic: the complaint and all attachment rows succeed together.
    const complaint = await prisma.complaint.create({
      data: { ...fields, userId: req.user.userId, status: "PENDING", attachments: { create: attachments } },
      select: {
        id: true, bookingId: true, category: true, subject: true, description: true,
        status: true, createdAt: true, updatedAt: true,
        attachments: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
      },
    });
    committed = true;
    response = { complaint };
  } catch (err) {
    status = [400, 403, 404, 413].includes(err.status) ? err.status : 500;
    response = { error: status === 500 ? "Internal server error" : err.message };
    if (status === 500) console.error("createComplaint error:", err);
  } finally {
    if (!committed || !req.files?.length) {
      try {
        await cleanupAttachments(req);
      } catch (err) {
        console.error("Complaint cleanup error:", err);
      }
    }
  }
  return res.status(status).json(response);
}

module.exports = { requireComplaintUser, createComplaint };
