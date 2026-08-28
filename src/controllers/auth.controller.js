const prisma = require("../lib/prisma");
const { hashPassword } = require("../utils/hash");

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

module.exports = { register };
