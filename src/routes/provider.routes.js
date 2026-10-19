const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { getMyServices, getMyBookingRequests } = require("../controllers/provider.controller");
const { getMyServiceAvailability, updateMyServiceAvailability } = require("../controllers/availability.controller");

const router = express.Router();

router.get("/me/services", authenticateToken, getMyServices);
router.get("/me/services/:id/availability", authenticateToken, getMyServiceAvailability);
router.put("/me/services/:id/availability", authenticateToken, updateMyServiceAvailability);
router.get("/me/booking-requests", authenticateToken, getMyBookingRequests);

module.exports = router;