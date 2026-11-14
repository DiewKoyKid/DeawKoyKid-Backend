process.env.JWT_SECRET = "notification-socket-test";
jest.mock("../src/lib/prisma", () => ({
  user: { findUnique: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock("../src/services/notification.service", () => ({
  sendBookingStatusEmails: jest.fn().mockResolvedValue(undefined),
}));

const http = require("node:http");
const { io: connect } = require("socket.io-client");
const { attachChat } = require("../src/socket/chat.socket");
const { signToken } = require("../src/utils/jwt");
const prisma = require("../src/lib/prisma");
const { notificationEvents, notificationsChanged } = require("../src/services/notificationEvents");
const { bookingTransaction } = require("../src/services/booking.service");
const { sendBookingStatusEmails } = require("../src/services/notification.service");

let io, url;
const clients = [];
beforeEach(async () => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockImplementation(async ({ where }) => ({ id: where.id, deletedAt: null }));
  const server = http.createServer();
  io = attachChat(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  clients.splice(0).forEach((socket) => socket.disconnect());
  await new Promise((resolve) => io.close(resolve));
  expect(notificationEvents.listenerCount("changed")).toBe(0);
});
async function client(userId) {
  const socket = connect(url, { auth: { token: signToken({ userId }) }, transports: ["websocket"], forceNew: true });
  clients.push(socket);
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
  return socket;
}
function nextChange(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Notification event not received")), 2000);
    socket.once("notifications:changed", () => { clearTimeout(timeout); resolve(); });
  });
}

it("delivers to all recipient tabs but never another user's socket", async () => {
  const [first, second, stranger] = await Promise.all([client("customer"), client("customer"), client("stranger")]);
  const leaked = jest.fn();
  stranger.on("notifications:changed", leaked);
  const received = Promise.all([nextChange(first), nextChange(second)]);
  notificationsChanged("customer");
  await received;
  // A subsequent event on the stranger's connection acts as an ordering barrier.
  const barrier = new Promise((resolve) => stranger.once("barrier", resolve));
  io.emit("barrier");
  await barrier;
  expect(leaked).not.toHaveBeenCalled();
});

it("rejects unauthenticated sockets", async () => {
  const socket = connect(url, { transports: ["websocket"], reconnection: false });
  clients.push(socket);
  const error = await new Promise((resolve) => socket.once("connect_error", resolve));
  expect(error.message).toBe("unauthorized");
});

it("rejects deleted accounts even with a valid token", async () => {
  prisma.user.findUnique.mockResolvedValue({ id: "deleted", deletedAt: new Date() });
  await expect(client("deleted")).rejects.toThrow("unauthorized");
});

it("publishes only after commit and before waiting for email", async () => {
  const recipient = await client("customer");
  let commit;
  prisma.$transaction.mockImplementation(() => new Promise((resolve) => { commit = resolve; }));
  const observed = jest.fn();
  notificationEvents.on("changed", observed);
  try {
    const transaction = bookingTransaction(() => {});
    expect(observed).not.toHaveBeenCalled();
    sendBookingStatusEmails.mockImplementation(async () => {
      expect(observed).toHaveBeenCalledWith("customer");
    });
    const received = nextChange(recipient);
    commit({ notifications: [{ userId: "customer" }, { userId: "customer" }] });
    await transaction;
    await received;
    expect(observed).toHaveBeenCalledTimes(1);
  } finally { notificationEvents.off("changed", observed); }
});

it("does not publish a rolled-back transaction", async () => {
  const observed = jest.fn();
  notificationEvents.on("changed", observed);
  try {
    prisma.$transaction.mockRejectedValue(new Error("rollback"));
    await expect(bookingTransaction(() => {})).rejects.toThrow("rollback");
    expect(observed).not.toHaveBeenCalled();
    expect(sendBookingStatusEmails).not.toHaveBeenCalled();
  } finally { notificationEvents.off("changed", observed); }
});
