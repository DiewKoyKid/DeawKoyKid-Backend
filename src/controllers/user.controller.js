const fs = require("fs/promises");
const path = require("path");
const prisma = require("../lib/prisma");
const { rolesFor } = require("../utils/roles");
const {
  PROFILE_PHOTO_DIR,
  PROFILE_PHOTO_URL_PREFIX,
} = require("../middlewares/profilePhotoUpload");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^0\d{9}$/;

// Adds the second profile to an account that already exists, so someone who
// books trips can also start guiding them without a separate login.
async function addProviderProfile(req, res, next) {
  try {
    const currentUserId = req.user.userId;
const { idCard, bio, languages, emergencyContactName, emergencyContactPhone } = req.body;

    if (!idCard) {
      return res.status(400).json({ error: "idCard is required for provider registration" });
    }

    if (!/^\d{13}$/.test(idCard)) {
      return res.status(400).json({ error: "idCard must be exactly 13 digits" });
    }

    if (emergencyContactPhone && !PHONE_PATTERN.test(emergencyContactPhone)) {
      return res.status(400).json({
        error: "emergencyContactPhone must be 10 digits starting with 0",
      });
    }

    const existing = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { provider: { select: { userId: true } } },
    });

    if (!existing) {
      return res.status(404).json({ error: "user not found" });
    }

    if (existing.provider) {
      return res.status(409).json({ error: "this account already has a provider profile" });
    }

    // status defaults to PENDING via the schema, same as provider registration
    const user = await prisma.user.update({
      where: { id: currentUserId },
      data: {
        provider: {
          create: { idCard, bio, languages, emergencyContactName, emergencyContactPhone },
        },
      },
      select: {
        id: true,
        username: true,
        email: true,
        firstname: true,
        lastname: true,
        profilePhotoUrl: true,
        customer: { select: { userId: true } },
        provider: { select: { userId: true, status: true } },
      },
    });

    return res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        profilePhotoUrl: user.profilePhotoUrl,
        roles: rolesFor(user),
      },
    });
  } catch (err) {
    next(err);
  }
}

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
        profilePhotoUrl: true,
        provider: { select: { bio: true, languages: true, interests: true, serviceArea: true } },
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
      interests,
      serviceArea
    } = req.body;

    if (gender && !["M", "F", "O"].includes(gender)) {
      return res.status(400).json({ error: "gender must be M, F, or O" });
    }

    if (phoneNumber && !PHONE_PATTERN.test(phoneNumber)) {
      return res.status(400).json({ error: "phoneNumber must be 10 digits starting with 0" });
    }
    if (languages !== undefined && !String(languages).trim()) {
      return res.status(400).json({ error: "Please select at least one language" });
    }
    for (const [name, value] of [["interests", interests], ["serviceArea", serviceArea]]) {
      if (value !== undefined && (!Array.isArray(value) || value.some((v) => typeof v !== "string"))) {
        return res.status(400).json({ error: `${name} must be an array of strings` });
      }
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
    const wantsProviderFieldsUpdated = [bio, languages, interests, serviceArea].some((v) => v !== undefined);
    
    if (wantsProviderFieldsUpdated && !isProvider) {
      return res.status(400).json({
           error: "provider details can only be updated on provider accounts",
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
          ? { update: { bio, languages, interests, serviceArea } }
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
        profilePhotoUrl: true,
        provider: { select: { bio: true, languages: true, interests: true, serviceArea: true } },
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
        profilePhotoUrl: true,
        provider: {
          select: {
            bio: true,
            languages: true,
            interests: true,
            serviceArea: true,
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

// Deletes a stored profile photo. URLs that aren't ours and files that are
// already gone are ignored: the database is the source of truth.
async function removeStoredPhoto(url) {
  if (!url || !url.startsWith(PROFILE_PHOTO_URL_PREFIX)) return;
  await fs.unlink(path.join(PROFILE_PHOTO_DIR, path.basename(url))).catch(() => {});
}

// The upload filter trusts the browser's content type, so also check the
// file really starts like a JPEG (FF D8 FF) or PNG (89 50 4E 47).
const IMAGE_SIGNATURES = [Buffer.from([0xff, 0xd8, 0xff]), Buffer.from([0x89, 0x50, 0x4e, 0x47])];

async function isJpegOrPng(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const { buffer } = await handle.read(Buffer.alloc(4), 0, 4, 0);
    return IMAGE_SIGNATURES.some((signature) => buffer.subarray(0, signature.length).equals(signature));
  } finally {
    await handle.close();
  }
}

// PUT /api/users/me/photo (multipart/form-data, field "photo")
// Replaces the signed-in user's profile photo; customers and providers alike.
async function uploadMyPhoto(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ error: "photo is required" });
  }
  const uploadedPath = req.file.path;

  try {
    if (!(await isJpegOrPng(uploadedPath))) {
      await fs.unlink(uploadedPath).catch(() => {});
      return res.status(400).json({ error: "photo must be a JPG or PNG image" });
    }

    const currentUserId = req.user.userId;
    const existing = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { profilePhotoUrl: true },
    });
    if (!existing) {
      await fs.unlink(uploadedPath).catch(() => {});
      return res.status(404).json({ error: "user not found" });
    }

    const profilePhotoUrl = `${PROFILE_PHOTO_URL_PREFIX}${req.file.filename}`;
    await prisma.user.update({ where: { id: currentUserId }, data: { profilePhotoUrl } });
    await removeStoredPhoto(existing.profilePhotoUrl);

    return res.status(200).json({ profilePhotoUrl });
  } catch (err) {
    await fs.unlink(uploadedPath).catch(() => {});
    next(err);
  }
}

// DELETE /api/users/me/photo
async function deleteMyPhoto(req, res, next) {
  try {
    const currentUserId = req.user.userId;
    const existing = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { profilePhotoUrl: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "user not found" });
    }

    await prisma.user.update({ where: { id: currentUserId }, data: { profilePhotoUrl: null } });
    await removeStoredPhoto(existing.profilePhotoUrl);

    return res.status(200).json({ profilePhotoUrl: null });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMyProfile,
  updateProfile,
  getPublicProfile,
  addProviderProfile,
  uploadMyPhoto,
  deleteMyPhoto,
};
