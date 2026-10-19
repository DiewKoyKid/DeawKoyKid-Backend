const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { getMyServices, getMyBookingRequests } = require("../controllers/provider.controller");

const router = express.Router();

router.get("/me/services", authenticateToken, getMyServices);
router.get("/me/booking-requests", authenticateToken, getMyBookingRequests);

module.exports = router;