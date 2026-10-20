const express = require("express");
const { authenticateToken } = require("../middlewares/auth.middleware");
const notificationController = require("../controllers/notification.controller");

const router = express.Router();

router.use(authenticateToken);
router.get("/", notificationController.getMyNotifications);
router.patch("/read-all", notificationController.markAllNotificationsAsRead);
router.patch("/:id/read", notificationController.markNotificationAsRead);

module.exports = router;