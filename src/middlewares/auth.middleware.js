const prisma = require("../lib/prisma");
const { verifyToken } = require("../utils/jwt");

async function authenticateToken(req, res, next) {
  const token =
    req.cookies?.token ||
    (req.headers.authorization && req.headers.authorization.split(" ")[1]);

  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    // Tokens live 30 minutes, so one issued before the account was deleted
    // (US2-3) is still validly signed. A user that doesn't exist is left to
    // the route, as before.
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { deletedAt: true },
    });
    if (user?.deletedAt) {
      return res.status(401).json({ error: "account has been deleted" });
    }
  } catch (err) {
    return next(err);
  }

  req.user = decoded; // แนบ { userId } เข้า req
  next();
}

module.exports = { authenticateToken };