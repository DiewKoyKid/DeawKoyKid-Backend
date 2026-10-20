process.env.JWT_SECRET = "notification-test-secret";

jest.mock("../src/lib/prisma", () => ({
  notification: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
}));

const express = require("express");
const request = require("supertest");
const prisma = require("../src/lib/prisma");
const { signToken } = require("../src/utils/jwt");
const notificationRoutes = require("../src/routes/notification.routes");

const app = express();
app.use(express.json());
app.use("/api/notifications", notificationRoutes);

function authorizedRequest(method, path, userId = "customer-id") {
  const req = request(app)[method](path);
  if (userId) req.set("Authorization", `Bearer ${signToken({ userId })}`);
  return req;
}

beforeEach(() => {
  jest.resetAllMocks();
});

it("requires authentication for notification operations", async () => {
  expect((await authorizedRequest("get", "/api/notifications", null)).status).toBe(401);
  expect(prisma.notification.findMany).not.toHaveBeenCalled();
});

it("returns only the signed-in user's notifications newest first", async () => {
  const notifications = [{
    id: "notification-id",
    bookingId: "booking-id",
    type: "BOOKING_CONFIRMED",
    message: "Your booking was confirmed.",
    isRead: false,
    createdAt: new Date("2026-10-19T12:00:00Z"),
  }];
  prisma.notification.findMany.mockResolvedValue(notifications);

  const res = await authorizedRequest("get", "/api/notifications");

  expect(res.status).toBe(200);
  expect(res.body.notifications).toHaveLength(1);
  expect(res.body.notifications[0]).toMatchObject({
    id: "notification-id",
    message: "Your booking was confirmed.",
    isRead: false,
  });
  expect(prisma.notification.findMany).toHaveBeenCalledWith({
    where: { userId: "customer-id" },
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
});

it("marks only the caller's notification as read", async () => {
  prisma.notification.updateMany.mockResolvedValue({ count: 1 });

  const res = await authorizedRequest("patch", "/api/notifications/notification-id/read");

  expect(res.status).toBe(200);
  expect(res.body.notification).toEqual({ id: "notification-id", isRead: true });
  expect(prisma.notification.updateMany).toHaveBeenCalledWith({
    where: { id: "notification-id", userId: "customer-id", isRead: false },
    data: { isRead: true },
  });
  expect(prisma.notification.findFirst).not.toHaveBeenCalled();
});

it("is idempotent when an owned notification is already read", async () => {
  prisma.notification.updateMany.mockResolvedValue({ count: 0 });
  prisma.notification.findFirst.mockResolvedValue({ id: "notification-id" });

  const res = await authorizedRequest("patch", "/api/notifications/notification-id/read");

  expect(res.status).toBe(200);
  expect(prisma.notification.findFirst).toHaveBeenCalledWith({
    where: { id: "notification-id", userId: "customer-id" },
    select: { id: true },
  });
});

it("does not expose another user's notification", async () => {
  prisma.notification.updateMany.mockResolvedValue({ count: 0 });
  prisma.notification.findFirst.mockResolvedValue(null);

  const res = await authorizedRequest("patch", "/api/notifications/notification-id/read");

  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: "Notification not found." });
});

it("marks all and only the caller's unread notifications as read", async () => {
  prisma.notification.updateMany.mockResolvedValue({ count: 3 });

  const res = await authorizedRequest("patch", "/api/notifications/read-all");

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ updatedCount: 3 });
  expect(prisma.notification.updateMany).toHaveBeenCalledWith({
    where: { userId: "customer-id", isRead: false },
    data: { isRead: true },
  });
});
