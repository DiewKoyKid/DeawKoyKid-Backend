const { verifyToken } = require("../utils/jwt");

function authenticateToken(req, res, next) {
  const token =
    req.cookies?.token ||
    (req.headers.authorization && req.headers.authorization.split(" ")[1]);

  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded; // แนบ { userId } เข้า req
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { authenticateToken };