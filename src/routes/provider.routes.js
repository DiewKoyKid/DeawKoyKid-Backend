const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { getMyServices, getMyService, getMyBookingRequests, getProviderReviews } = require("../controllers/provider.controller");
const { getMyServiceAvailability, updateMyServiceAvailability } = require("../controllers/availability.controller");

const router = express.Router();

router.get("/me/services", authenticateToken, getMyServices);
router.get("/me/services/:id", authenticateToken, getMyService);
router.get("/me/services/:id/availability", authenticateToken, getMyServiceAvailability);
router.put("/me/services/:id/availability", authenticateToken, updateMyServiceAvailability);
router.get("/me/booking-requests", authenticateToken, getMyBookingRequests);
// Public: the reviews section on a provider's profile (US8-2)
router.get("/:id/reviews", getProviderReviews);

module.exports = router;