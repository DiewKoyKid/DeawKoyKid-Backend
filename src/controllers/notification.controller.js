const prisma = require("../lib/prisma");

async function getMyNotifications(req, res, next) {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        bookingId: true,
        type: true,
        message: true,
        isRead: true,
        createdAt: true,
      },
    });

    return res.status(200).json({ notifications });
  } catch (err) {
    return next(err);
  }
}

async function markNotificationAsRead(req, res, next) {
  try {
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.userId, isRead: false },
      data: { isRead: true },
    });

    if (result.count === 0) {
      const notification = await prisma.notification.findFirst({
        where: { id: req.params.id, userId: req.user.userId },
        select: { id: true },
      });
      if (!notification) return res.status(404).json({ error: "Notification not found." });
    }

    return res.status(200).json({
      notification: { id: req.params.id, isRead: true },
    });
  } catch (err) {
    return next(err);
  }
}

async function markAllNotificationsAsRead(req, res, next) {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.userId, isRead: false },
      data: { isRead: true },
    });

    return res.status(200).json({ updatedCount: result.count });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};