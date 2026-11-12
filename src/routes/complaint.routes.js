const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { complaintUpload } = require("../middlewares/complaintUpload");
const { requireComplaintUser, createComplaint } = require("../controllers/complaint.controller");

const router = express.Router();
router.post("/", authenticateToken, requireComplaintUser, complaintUpload, createComplaint);
module.exports = router;
