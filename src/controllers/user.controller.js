const prisma = require("../lib/prisma");

async function updateProfile(req, res, next) {
  try {
    const currentUserId = req.user.userId; // Owner check — id comes straight from the JWT
    const {
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

module.exports = { updateProfile };
