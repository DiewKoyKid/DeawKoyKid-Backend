const prisma = require("../lib/prisma");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getMyProfile(req, res, next) {
  try {
    const currentUserId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: {
        id: true,
        username: true,
        email: true,
        firstname: true,
        lastname: true,
        gender: true,
        bdate: true,
        bankAccount: true,
        phoneNumber: true,
        instagram: true,
        line: true,
        facebook: true,
        provider: { select: { bio: true, languages: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }

    return res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const currentUserId = req.user.userId; // Owner check — id comes straight from the JWT
    const {
      email,
      firstname,
      lastname,
      gender,
      bdate,
      bankAccount,
      phoneNumber,
      instagram,
      line,
      facebook,
      bio,
      languages,
    } = req.body;

    if (gender && !["M", "F", "O"].includes(gender)) {
      return res.status(400).json({ error: "gender must be M, F, or O" });
    }

    const normalizedEmail = email !== undefined ? email.trim().toLowerCase() : undefined;
    if (email !== undefined && !EMAIL_PATTERN.test(normalizedEmail)) {
      return res.status(400).json({ error: "email must be a valid email address" });
    }

    // Check whether this user actually has a Provider profile before
    // attempting to update provider-only fields (bio/languages).
    // Without this check, a Customer sending bio/languages would hit
    // Prisma's "Record to update not found" error, since they have
    // no related Provider row.
    const existingUser = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { provider: { select: { userId: true } } },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "user not found" });
    }

    if (normalizedEmail !== undefined) {
      const emailOwner = await prisma.user.findFirst({
        where: { email: normalizedEmail, NOT: { id: currentUserId } },
        select: { id: true },
      });

      if (emailOwner) {
        return res.status(409).json({ error: "email already taken" });
      }
    }

    const isProvider = !!existingUser.provider;
    const wantsProviderFieldsUpdated = bio !== undefined || languages !== undefined;

    if (wantsProviderFieldsUpdated && !isProvider) {
      return res.status(400).json({
        error: "bio and languages can only be updated on provider accounts",
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: currentUserId },
      data: {
        email: normalizedEmail,
        firstname,
        lastname,
        gender,
        bdate: bdate ? new Date(bdate) : undefined,
        bankAccount,
        phoneNumber,
        instagram,
        line,
        facebook,
        provider: wantsProviderFieldsUpdated
          ? { update: { bio, languages } }
          : undefined,
      },
      select: {
        id: true,
        username: true,
        email: true,
        firstname: true,
        lastname: true,
        gender: true,
        bdate: true,
        bankAccount: true,
        phoneNumber: true,
        instagram: true,
        line: true,
        facebook: true,
        provider: { select: { bio: true, languages: true } },
      },
    });

    return res.status(200).json({ user: updatedUser });
  } catch (err) {
    next(err);
  }
}

async function getPublicProfile(req, res, next) {
  try {
    const { id } = req.params;

    // Explicit whitelist select — only fields safe to expose publicly.
    // password, bankAccount, phoneNumber (User) and idCard,
    // emergencyContactName, emergencyContactPhone, status (Provider)
    // are intentionally never selected here, not just filtered out
    // afterward, so a future field added to the schema can't leak
    // by accident.
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        firstname: true,
        lastname: true,
        gender: true,
        instagram: true,
        line: true,
        facebook: true,
        provider: {
          select: {
            bio: true,
            languages: true,
            avgRating: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }

    return res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMyProfile, updateProfile, getPublicProfile };
