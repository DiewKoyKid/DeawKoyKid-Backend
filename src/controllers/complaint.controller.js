const storage = require('../services/storage.service');
const { ComplaintCategory } = require("@prisma/client");
const prisma = require("../lib/prisma");
const path = require("node:path");
const {
  STORAGE_ROOT, badRequest, validateAttachment, persistAttachments, cleanupAttachments,
} = require("../utils/complaintAttachments");

// authenticateToken intentionally permits a token whose user no longer exists.
// Reject that case here before accepting files, without changing other routes.
async function requireComplaintUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { deletedAt: true, isAdmin: true } });
    if (!user || user.deletedAt) return res.status(401).json({ error: "Account is unavailable" });
    req.complaintUser = user;
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
    if (committed) req.remoteAttachmentKeys = [];
    if (storage.enabled() || !committed || !req.files?.length) {
      try {
        await cleanupAttachments(req);
      } catch (err) {
        console.error("Complaint cleanup error:", err);
      }
    }
  }
  return res.status(status).json(response);
}

const summary = {
  id: true, bookingId: true, category: true, subject: true, status: true, createdAt: true,
  booking: { select: { service: { select: { title: true } } } },
};
const details = {
  ...summary, description: true, adminReply: true, updatedAt: true,
  attachments: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
};

function requireComplaintAdmin(req, res, next) {
  if (!req.complaintUser.isAdmin) {
    return res.status(403).json({ error: "Complaint admin access required" });
  }
  req.complaintAdmin = true;
  return next();
}

function complaintScope(req) {
  return req.complaintAdmin ? {} : { userId: req.user.userId };
}

async function listComplaints(req, res, next) {
  try {
    const complaints = await prisma.complaint.findMany({
      where: complaintScope(req),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: summary,
    });
    return res.json({ complaints });
  } catch (err) {
    return next(err);
  }
}

async function getComplaint(req, res, next) {
  try {
    const complaint = await prisma.complaint.findFirst({
      where: { id: req.params.id, ...complaintScope(req) },
      select: details,
    });
    if (!complaint) return res.status(404).json({ error: "Complaint not found" });
    return res.json({ complaint });
  } catch (err) {
    return next(err);
  }
}

async function downloadAttachment(req, res, next) {
  try {
    const file = await prisma.complaintAttachment.findFirst({
      where: { id: req.params.attachmentId, complaintId: req.params.id, complaint: complaintScope(req) },
      select: { originalName: true, storageKey: true },
    });
    if (!file) return res.status(404).json({ error: "Attachment not found" });
    if (storage.enabled()) return await storage.download('complaint-attachments', file.storageKey, res, file.originalName);
    const filename = path.resolve(STORAGE_ROOT, file.storageKey);
    const relative = path.relative(STORAGE_ROOT, filename);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return res.status(404).json({ error: "Attachment not found" });
    }
    res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    return res.download(filename, file.originalName, (err) => {
      if (!err) return;
      if (!res.headersSent && err.status === 404) return res.status(404).json({ error: "Attachment not found" });
      return next(err);
    });
  } catch (err) {
    return next(err);
  }
}

const transitions = {
  PENDING: "IN_PROGRESS",
  IN_PROGRESS: "RESOLVED",
};

async function updateComplaint(req, res, next) {
  const { expectedStatus, expectedUpdatedAt, status, adminReply } = req.body || {};
  const version = typeof expectedUpdatedAt === "string" ? new Date(expectedUpdatedAt) : null;
  if (!Object.hasOwn(transitions, expectedStatus) ||
      (status !== expectedStatus && status !== transitions[expectedStatus]) ||
      !version || Number.isNaN(version.getTime()) ||
      typeof adminReply !== "string" || [...adminReply.trim()].length > 2000) {
    return res.status(400).json({ error: "Invalid complaint status or reply" });
  }
  try {
    const result = await prisma.complaint.updateMany({
      where: { id: req.params.id, status: expectedStatus, updatedAt: version },
      data: { status, adminReply: adminReply.trim() || null },
    });
    if (!result.count) return res.status(409).json({ error: "Complaint changed. Reload before updating." });
    return getComplaint(req, res, next);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  requireComplaintUser, createComplaint, requireComplaintAdmin, listComplaints,
  getComplaint, downloadAttachment, updateComplaint,
};
