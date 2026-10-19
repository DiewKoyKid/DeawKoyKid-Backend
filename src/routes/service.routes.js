const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const { createService, getServiceById, searchServices } = require("../controllers/service.controller");
const { addAvailability, replaceAvailability } = require("../controllers/availability.controller");

const router = express.Router();

router.post("/", authenticateToken, createService);
router.post("/:id/availability", authenticateToken, addAvailability);
router.put("/:id/availability", authenticateToken, replaceAvailability);
router.get("/search", searchServices);
router.get("/:id", getServiceById);

module.exports = router;
