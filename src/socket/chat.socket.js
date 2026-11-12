// Real-time booking chat over Socket.IO (US7-1).
//
// Client flow:
//   socket.emit("chat:join", { bookingId }, ack)            -> ack({ ok, error? })
//   socket.emit("chat:message", { bookingId, content }, ack) -> ack({ ok, message?, error? })
//   socket.on("chat:message", message)                       // everyone in the booking room
//
// The socket is authenticated with the same JWT as the REST API: the `token`
// cookie, or `auth.token` in the handshake.
const { Server } = require("socket.io");
const prisma = require("../lib/prisma");
const { verifyToken } = require("../utils/jwt");
const { getChatAccess, createMessage } = require("../services/chat.service");

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

const roomFor = (bookingId) => `booking:${bookingId}`;

// The running Socket.IO server, so REST routes (photo upload) can broadcast too.
let ioInstance = null;
function broadcastMessage(message) {
  ioInstance?.to(roomFor(message.bookingId)).emit("chat:message", message);
}

async function authenticateSocket(socket, next) {
  const token =
    socket.handshake.auth?.token || readCookie(socket.handshake.headers.cookie, "token");
  if (!token) return next(new Error("unauthorized"));
  try {
    const { userId } = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });
    if (!user || user.deletedAt) return next(new Error("unauthorized"));
    socket.data.userId = userId;
    next();
  } catch {
    next(new Error("unauthorized"));
  }
}

function errorAck(ack, err) {
  if (typeof ack !== "function") return;
  if (!err.status) console.error(err);
  ack({ ok: false, status: err.status || 500, error: err.status ? err.message : "server error" });
}

function registerChatHandlers(io, socket) {
  const { userId } = socket.data;

  socket.on("chat:join", async ({ bookingId } = {}, ack) => {
    try {
      await getChatAccess(bookingId, userId);
      await socket.join(roomFor(bookingId));
      if (typeof ack === "function") ack({ ok: true });
    } catch (err) {
      errorAck(ack, err);
    }
  });

  socket.on("chat:leave", ({ bookingId } = {}) => {
    if (bookingId) socket.leave(roomFor(bookingId));
  });

  socket.on("chat:message", async ({ bookingId, content } = {}, ack) => {
    try {
      // Checked on every message: the booking may have been cancelled or
      // completed since the user joined.
      await getChatAccess(bookingId, userId, { write: true });
      const message = await createMessage(bookingId, userId, content);
      broadcastMessage(message);
      if (typeof ack === "function") ack({ ok: true, message });
    } catch (err) {
      errorAck(ack, err);
    }
  });
}

function attachChat(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || "http://localhost:5173",
      credentials: true,
    },
  });
  ioInstance = io;
  io.use(authenticateSocket);
  io.on("connection", (socket) => registerChatHandlers(io, socket));
  return io;
}

module.exports = { attachChat, broadcastMessage, readCookie };
