const prisma = require("../lib/prisma");
const { hashPassword, comparePassword } = require("../utils/hash");
const { signToken } = require("../utils/jwt");
const { rolesFor } = require("../utils/roles");

const COOKIE_NAME = "token";
const COOKIE_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes, matches JWT_EXPIRES_IN default
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^0\d{9}$/;

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

async function register(req, res, next) {
  try {
    const {
      username,
      email,
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
      consent,
    } = req.body;

    if (!username || !email || !password || !firstname || !lastname) {
      return res.status(400).json({
        error: "username, email, password, firstname, and lastname are required",
      });
    }

    if (consent !== true) {
      return res.status(400).json({
        error: "consent to the privacy policy is required to register",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return res.status(400).json({ error: "email must be a valid email address" });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "password must be at least 8 characters",
      });
    }

    if (gender && !["M", "F", "O"].includes(gender)) {
      return res.status(400).json({ error: "gender must be M, F, or O" });
    }

    if (phoneNumber && !PHONE_PATTERN.test(phoneNumber)) {
      return res.status(400).json({ error: "phoneNumber must be 10 digits starting with 0" });
    }

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ username }, { email: normalizedEmail }] },
      select: { username: true, email: true },
    });
    if (existingUser) {
      const error = existingUser.username === username
        ? "username already taken"
        : "email already taken";
      return res.status(409).json({ error });
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        username,
        email: normalizedEmail,
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
        consentAt: new Date(),
        customer: { create: {} }, // links the 1:1 Customer row automatically
      },
      select: {
        id: true,
        username: true,
        email: true,
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

async function registerProvider(req, res, next) {
  try {
    const {
      username,
      email,
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
      idCard,
      bio,
      languages,
      emergencyContactName,
      emergencyContactPhone,
      consent,
    } = req.body;

    // Required-field validation — same base fields as customer registration,
    // plus idCard, which is required to identify a Provider per the final report
    if (!username || !email || !password || !firstname || !lastname) {
      return res.status(400).json({
        error: "username, email, password, firstname, and lastname are required",
      });
    }

    if (consent !== true) {
      return res.status(400).json({
        error: "consent to the privacy policy is required to register",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return res.status(400).json({ error: "email must be a valid email address" });
    }

    if (!idCard) {
      return res.status(400).json({ error: "idCard is required for provider registration" });
    }

    if (!/^\d{13}$/.test(idCard)) {
      return res.status(400).json({ error: "idCard must be exactly 13 digits" });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "password must be at least 8 characters",
      });
    }

    if (gender && !["M", "F", "O"].includes(gender)) {
      return res.status(400).json({ error: "gender must be M, F, or O" });
    }

    if (phoneNumber && !PHONE_PATTERN.test(phoneNumber)) {
      return res.status(400).json({ error: "phoneNumber must be 10 digits starting with 0" });
    }

    if (emergencyContactPhone && !PHONE_PATTERN.test(emergencyContactPhone)) {
      return res.status(400).json({
        error: "emergencyContactPhone must be 10 digits starting with 0",
      });
    }

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ username }, { email: normalizedEmail }] },
      select: { username: true, email: true },
    });
    if (existingUser) {
      const error = existingUser.username === username
        ? "username already taken"
        : "email already taken";
      return res.status(409).json({ error });
    }

    const hashedPassword = await hashPassword(password);

    // status defaults to "PENDING" via the schema — not set explicitly here,
    // so approval workflow (Admin flipping it to APPROVED) stays a separate concern
    const user = await prisma.user.create({
      data: {
        username,
        email: normalizedEmail,
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
        consentAt: new Date(),
        provider: {
          create: {
            idCard,
            bio,
            languages,
            emergencyContactName,
            emergencyContactPhone,
          },
        },
        // Providers can book trips of their own, so they get a customer
        // profile too rather than needing a second account for it
        customer: { create: {} },
      },
      select: {
        id: true,
        username: true,
        email: true,
        firstname: true,
        lastname: true,
        createdAt: true,
        provider: {
          select: {
            status: true,
            idCard: true,
            bio: true,
            languages: true,
          },
        },
      },
    });

    return res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, username, password } = req.body;
    const normalizedEmail = email ? normalizeEmail(email) : null;

    if ((!normalizedEmail && !username) || !password) {
      return res.status(400).json({
        error: "a username or email, and a password, are required",
      });
    }

    if (normalizedEmail && !EMAIL_PATTERN.test(normalizedEmail)) {
      return res.status(400).json({ error: "email must be a valid email address" });
    }

    const user = await prisma.user.findUnique({
      where: normalizedEmail ? { email: normalizedEmail } : { username },
      // Needed to tell the client which dashboards this account can reach
      include: {
        provider: { select: { userId: true } },
        customer: { select: { userId: true } },
      },
    });

    if (!user) {
      return res.status(401).json({ error: "invalid email or password" });
    }

    const passwordMatches = await comparePassword(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "invalid email or password" });
    }

    const token = signToken({ userId: user.id });

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE_MS,
    });

    return res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        roles: rolesFor(user),
      },
    });
  } catch (err) {
    next(err);
  }
}

function logout(req, res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  return res.status(200).json({ message: "logged out" });
}

module.exports = { register, registerProvider, login, logout };
