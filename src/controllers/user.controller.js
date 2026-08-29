const prisma = require("../lib/prisma");

async function updateProfile(req, res, next) {
  try {
    const currentUserId = req.user.userId; // Owner Check ดึง id จาก Token โดยตรง
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
        provider: bio || languages ? {
          update: { bio, languages }
        } : undefined,
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