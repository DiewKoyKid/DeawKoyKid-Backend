const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { complaintUpload } = require("../middlewares/complaintUpload");
const {
  requireComplaintUser, createComplaint, requireComplaintAdmin, listComplaints,
  getComplaint, downloadAttachment, updateComplaint,
} = require("../controllers/complaint.controller");

const router = express.Router();
router.use(authenticateToken, requireComplaintUser);
router.post("/", complaintUpload, createComplaint);
router.get("/me", listComplaints);
router.get("/admin", requireComplaintAdmin, listComplaints);
router.get("/admin/:id", requireComplaintAdmin, getComplaint);
router.patch("/admin/:id", requireComplaintAdmin, updateComplaint);
router.get("/admin/:id/attachments/:attachmentId", requireComplaintAdmin, downloadAttachment);
router.get("/:id", getComplaint);
router.get("/:id/attachments/:attachmentId", downloadAttachment);
module.exports = router;
