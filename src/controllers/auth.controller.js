const prisma = require("../lib/prisma");
const { hashPassword, comparePassword } = require("../utils/hash");
const { signToken } = require("../utils/jwt");

const COOKIE_NAME = "token";
const COOKIE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes, matches JWT_EXPIRES_IN default

async function register(req, res, next) {
  try {
    const {
      username,
      password,
      firstname,
      lastname,
      gender,
      bdate,
      bankAccount,
      phoneNumber,
      instagram,
      line,
      facebook,
    } = req.body;

    // Required-field validation
    if (!username || !password || !firstname || !lastname) {
      return res.status(400).json({
        error: "username, password, firstname, and lastname are required",
      });
    }

    // Password strength check
    if (password.length < 8) {
      return res.status(400).json({
        error: "password must be at least 8 characters",
      });
    }

    // Optional: basic gender check to match schema's Char(1)
    if (gender && !["M", "F", "O"].includes(gender)) {
      return res.status(400).json({ error: "gender must be M, F, or O" });
    }

    // Check for duplicate username
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(409).json({ error: "username already taken" });
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        firstname,
        lastname,
        gender,
        bdate: bdate ? new Date(bdate) : undefined,
        bankAccount,
        phoneNumber,
        instagram,
        line,
        facebook,
        customer: { create: {} }, // links the 1:1 Customer row automatically
      },
      select: {
        id: true,
        username: true,
        firstname: true,
        lastname: true,
        createdAt: true,
      },
    });

    return res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "username and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { username } });

    // Same error for "no such user" and "wrong password" — don't leak which one it was
    if (!user) {
      return res.status(401).json({ error: "invalid username or password" });
    }

    const passwordMatches = await comparePassword(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "invalid username or password" });
    }

    const token = signToken({ userId: user.id });

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // requires HTTPS in prod, allows plain HTTP in local dev
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE_MS,
    });

    return res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        firstname: user.firstname,
        lastname: user.lastname,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login };
