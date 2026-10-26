const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { hashPassword } = require("../utils/hash");

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Only this hash is stored; the raw token lives in the emailed link alone.
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// US1-5: issues a reset token for the user and voids any earlier unused ones,
// so only the newest emailed link works. Resolves to the raw token.
async function createResetToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
      },
    }),
  ]);

  return token;
}

// US1-5: sets a new password with a reset token. Resolves to true, or to
// false when the token is unknown, expired, already used or belongs to a
// deleted account (nothing changes in those cases).
async function resetPassword(token, newPassword) {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { deletedAt: true } } },
  });
  if (!record || record.usedAt || record.expiresAt <= new Date() || record.user.deletedAt) {
    return false;
  }

  const hashedPassword = await hashPassword(newPassword);

  return prisma.$transaction(async (tx) => {
    // Claim the token first: of two requests with the same link, only one
    // gets count 1, so the link works once.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) return false;

    await tx.user.update({
      where: { id: record.userId },
      data: { password: hashedPassword },
    });
    // Any other link still in someone's inbox is void now too
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    return true;
  });
}

module.exports = { TOKEN_TTL_MS, hashToken, createResetToken, resetPassword };
