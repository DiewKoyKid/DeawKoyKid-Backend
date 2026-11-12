// Booking chat (US7-1): history endpoint, access rules (HTTP 403) and
// real-time delivery over Socket.IO. Runs without PostgreSQL.
process.env.JWT_SECRET = "chat-test-secret";

jest.mock("../src/lib/prisma", () => ({
  user: { findUnique: jest.fn() },
  booking: { findUnique: jest.fn() },
  chatLog: { findMany: jest.fn(), create: jest.fn() },
}));

const http = require("http");
const express = require("express");
const request = require("supertest");
const { io: connect } = require("socket.io-client");
const prisma = require("../src/lib/prisma");
const { signToken } = require("../src/utils/jwt");
const bookingRoutes = require("../src/routes/booking.routes");
const { attachChat } = require("../src/socket/chat.socket");

const app = express();
app.use(express.json());
app.use("/api/bookings", bookingRoutes);

const users = {
  "customer-id": { id: "customer-id", firstname: "Cus", lastname: "Tomer" },
  "provider-id": { id: "provider-id", firstname: "Pro", lastname: "Vider" },
  "stranger-id": { id: "stranger-id", firstname: "Stran", lastname: "Ger" },
};

let booking;
let stored;
beforeEach(() => {
  jest.resetAllMocks();
  booking = {
    id: "booking-id",
    customerId: "customer-id",
    bookingStatus: "CONFIRMED",
    service: { providerId: "provider-id", title: "Food walk" },
  };
  stored = [];
  prisma.user.findUnique.mockImplementation(async ({ where }) =>
    users[where.id] ? { ...users[where.id], deletedAt: null } : null
  );
  prisma.booking.findUnique.mockImplementation(async ({ where }) =>
    where.id === booking.id ? booking : null
  );
  prisma.chatLog.findMany.mockImplementation(async () => stored);
  prisma.chatLog.create.mockImplementation(async ({ data }) => {
    const row = {
      id: `msg-${stored.length + 1}`,
      ...data,
      timestamp: new Date("2026-11-12T12:00:00Z"),
      sender: users[data.senderId],
    };
    stored.push(row);
    return row;
  });
});

const tokenFor = (userId) => signToken({ userId });

function history(userId, bookingId = "booking-id") {
  const req = request(app).get(`/api/bookings/${bookingId}/messages`);
  if (userId) req.set("Authorization", `Bearer ${tokenFor(userId)}`);
  return req;
}

describe("GET /api/bookings/:id/messages", () => {
  it("requires a token", async () => {
    expect((await history(null)).status).toBe(401);
  });

  it("returns the history to the customer and the provider", async () => {
    stored.push({
      id: "m1", bookingId: "booking-id", senderId: "provider-id", content: "Hi!",
      timestamp: new Date("2026-11-12T10:00:00Z"), sender: users["provider-id"],
    });
    for (const userId of ["customer-id", "provider-id"]) {
      const res = await history(userId);
      expect(res.status).toBe(200);
      expect(res.body.role).toBe(userId === "customer-id" ? "customer" : "provider");
      expect(res.body.booking).toMatchObject({ id: "booking-id", canSend: true });
      expect(res.body.messages).toEqual([
        expect.objectContaining({
          id: "m1", senderId: "provider-id", senderName: "Pro Vider",
          content: "Hi!", timestamp: "2026-11-12T10:00:00.000Z",
        }),
      ]);
    }
    expect(prisma.chatLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { bookingId: "booking-id" }, orderBy: { timestamp: "asc" } })
    );
  });

  it("returns 403 to someone outside the booking", async () => {
    const res = await history("stranger-id");
    expect(res.status).toBe(403);
    expect(prisma.chatLog.findMany).not.toHaveBeenCalled();
  });

  it.each(["WAITING_FOR_CONFIRMATION", "REJECTED", "EXPIRED", "CANCELLED"])(
    "returns 403 while the booking is %s",
    async (status) => {
      booking.bookingStatus = status;
      expect((await history("customer-id")).status).toBe(403);
    }
  );

  it("keeps history readable but closed for sending once COMPLETED", async () => {
    booking.bookingStatus = "COMPLETED";
    const res = await history("customer-id");
    expect(res.status).toBe(200);
    expect(res.body.booking.canSend).toBe(false);
  });

  it("returns 404 for an unknown booking", async () => {
    expect((await history("customer-id", "nope")).status).toBe(404);
  });
});

describe("Socket.IO chat", () => {
  let server;
  let url;
  const sockets = [];

  beforeAll(async () => {
    server = http.createServer();
    const io = attachChat(server);
    server.once("close", () => io.close());
    await new Promise((resolve) => server.listen(0, resolve));
    url = `http://localhost:${server.address().port}`;
  });

  afterEach(() => {
    while (sockets.length) sockets.pop().disconnect();
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  function open(userId) {
    const socket = connect(url, {
      auth: userId ? { token: tokenFor(userId) } : {},
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  }

  const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
  const emit = (socket, event, payload) =>
    new Promise((resolve) => socket.emit(event, payload, resolve));

  it("rejects a connection without a valid token", async () => {
    const err = await once(open(null), "connect_error");
    expect(err.message).toBe("unauthorized");
  });

  it("delivers a message to the other side and stores it", async () => {
    const customer = open("customer-id");
    const provider = open("provider-id");
    expect(await emit(customer, "chat:join", { bookingId: "booking-id" })).toEqual({ ok: true });
    expect(await emit(provider, "chat:join", { bookingId: "booking-id" })).toEqual({ ok: true });

    const received = once(provider, "chat:message");
    const ack = await emit(customer, "chat:message", {
      bookingId: "booking-id", content: "  Meet at the BTS?  ",
    });

    expect(ack.ok).toBe(true);
    expect(await received).toMatchObject({
      bookingId: "booking-id", senderId: "customer-id",
      senderName: "Cus Tomer", content: "Meet at the BTS?",
    });
    expect(prisma.chatLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { bookingId: "booking-id", senderId: "customer-id", content: "Meet at the BTS?" },
      })
    );
  });

  it("does not let an outsider join or send", async () => {
    const stranger = open("stranger-id");
    expect(await emit(stranger, "chat:join", { bookingId: "booking-id" })).toMatchObject({
      ok: false, status: 403,
    });
    expect(
      await emit(stranger, "chat:message", { bookingId: "booking-id", content: "hey" })
    ).toMatchObject({ ok: false, status: 403 });
    expect(prisma.chatLog.create).not.toHaveBeenCalled();
  });

  it("refuses to send once the booking is no longer confirmed", async () => {
    const customer = open("customer-id");
    await emit(customer, "chat:join", { bookingId: "booking-id" });
    booking.bookingStatus = "COMPLETED";
    expect(
      await emit(customer, "chat:message", { bookingId: "booking-id", content: "still there?" })
    ).toMatchObject({ ok: false, status: 403 });
    expect(prisma.chatLog.create).not.toHaveBeenCalled();
  });

  it("rejects an empty message", async () => {
    const customer = open("customer-id");
    expect(
      await emit(customer, "chat:message", { bookingId: "booking-id", content: "   " })
    ).toMatchObject({ ok: false, status: 400 });
  });
});
