require("dotenv").config();
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");
const { PROFILE_PHOTO_DIR } = require("../src/middlewares/profilePhotoUpload");

const createdUsernames = [];
const createdUserIds = [];

// A real 1×1 PNG, and bytes that start like a JPEG (only the signature is checked).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

function uniqueUser(prefix) {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const username = `${prefix}_${suffix}`;
  createdUsernames.push(username);
  return {
    username,
    email: `${username}@example.com`,
    password: "correct-horse-battery-staple",
    firstname: "Test",
    lastname: "User",
    consent: true,
  };
}

async function registerAndLogin(agent, payload, registerPath = "/api/auth/register") {
  await agent.post(registerPath).send(payload);
  const loginRes = await agent
    .post("/api/auth/login")
    .send({ email: payload.email, password: payload.password });
  createdUserIds.push(loginRes.body.user.id);
  return loginRes.body.user;
}

function storedFile(url) {
  return path.join(PROFILE_PHOTO_DIR, path.basename(url));
}

// Files the tests' users left in the photo folder (all should be cleaned up).
function filesFor(userId) {
  return fs.readdirSync(PROFILE_PHOTO_DIR).filter((name) => name.startsWith(`${userId}-`));
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    for (const name of filesFor(userId)) fs.rmSync(path.join(PROFILE_PHOTO_DIR, name), { force: true });
  }
  await prisma.service.deleteMany({ where: { providerId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { username: { in: createdUsernames } } });
  await prisma.$disconnect();
});

describe("PUT /api/users/me/photo", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app)
      .put("/api/users/me/photo")
      .attach("photo", PNG, { filename: "me.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });

  it("saves a customer's PNG and returns it everywhere the user appears", async () => {
    const agent = request.agent(app);
    const payload = uniqueUser("photo_customer");
    const user = await registerAndLogin(agent, payload);
    expect(user.profilePhotoUrl).toBeNull();

    const res = await agent
      .put("/api/users/me/photo")
      .attach("photo", PNG, { filename: "me.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.profilePhotoUrl).toMatch(/^\/uploads\/profile-photos\/.+\.png$/);
    const url = res.body.profilePhotoUrl;
    expect(fs.existsSync(storedFile(url))).toBe(true);

    const me = await agent.get("/api/users/me");
    expect(me.body.user.profilePhotoUrl).toBe(url);

    const publicProfile = await request(app).get(`/api/users/${user.id}`);
    expect(publicProfile.body.user.profilePhotoUrl).toBe(url);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: payload.email, password: payload.password });
    expect(login.body.user.profilePhotoUrl).toBe(url);

    const image = await request(app).get(url);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toMatch(/image\/png/);
  });

  it("saves a provider's JPEG and shows it on their service detail", async () => {
    const agent = request.agent(app);
    const provider = await registerAndLogin(
      agent,
      { ...uniqueUser("photo_provider"), idCard: "1234567890123" },
      "/api/auth/register/provider",
    );

    const res = await agent
      .put("/api/users/me/photo")
      .attach("photo", JPEG, { filename: "me.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(200);
    expect(res.body.profilePhotoUrl).toMatch(/\.jpg$/);

    const service = await prisma.service.create({
      data: { providerId: provider.id, title: "Temple walk", location: "Bangkok", rate: 500 },
    });
    const detail = await request(app).get(`/api/services/${service.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.service.provider.profilePhotoUrl).toBe(res.body.profilePhotoUrl);
  });

  it("replaces the old photo and deletes its file", async () => {
    const agent = request.agent(app);
    const user = await registerAndLogin(agent, uniqueUser("photo_replace"));

    const first = await agent
      .put("/api/users/me/photo")
      .attach("photo", PNG, { filename: "a.png", contentType: "image/png" });
    const second = await agent
      .put("/api/users/me/photo")
      .attach("photo", JPEG, { filename: "b.jpg", contentType: "image/jpeg" });

    expect(second.status).toBe(200);
    expect(second.body.profilePhotoUrl).not.toBe(first.body.profilePhotoUrl);
    expect(fs.existsSync(storedFile(first.body.profilePhotoUrl))).toBe(false);
    expect(filesFor(user.id)).toEqual([path.basename(second.body.profilePhotoUrl)]);
  });

  describe("rejects bad uploads with 400 and keeps nothing", () => {
    let agent;
    let user;

    beforeAll(async () => {
      agent = request.agent(app);
      user = await registerAndLogin(agent, uniqueUser("photo_invalid"));
    });

    afterEach(async () => {
      expect(filesFor(user.id)).toEqual([]);
      const me = await agent.get("/api/users/me");
      expect(me.body.user.profilePhotoUrl).toBeNull();
    });

    it("when no file is sent", async () => {
      const res = await agent.put("/api/users/me/photo");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/photo is required/);
    });

    it("when the file isn't a JPG or PNG", async () => {
      const res = await agent
        .put("/api/users/me/photo")
        .attach("photo", Buffer.from("GIF89a"), { filename: "me.gif", contentType: "image/gif" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/JPG or PNG/);
    });

    it("when a non-image is labelled as a PNG", async () => {
      const res = await agent
        .put("/api/users/me/photo")
        .attach("photo", Buffer.from("not really an image"), {
          filename: "me.png",
          contentType: "image/png",
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/JPG or PNG/);
    });

    it("when the file is over 5 MB", async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
      const res = await agent
        .put("/api/users/me/photo")
        .attach("photo", big, { filename: "big.png", contentType: "image/png" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/5 MB/);
    });

    it("when the image is in the wrong form field", async () => {
      const res = await agent
        .put("/api/users/me/photo")
        .attach("avatar", PNG, { filename: "me.png", contentType: "image/png" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/"photo"/);
    });
  });
});

describe("DELETE /api/users/me/photo", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).delete("/api/users/me/photo");
    expect(res.status).toBe(401);
  });

  it("removes the photo and its file", async () => {
    const agent = request.agent(app);
    const user = await registerAndLogin(agent, uniqueUser("photo_delete"));
    const upload = await agent
      .put("/api/users/me/photo")
      .attach("photo", PNG, { filename: "me.png", contentType: "image/png" });

    const res = await agent.delete("/api/users/me/photo");

    expect(res.status).toBe(200);
    expect(res.body.profilePhotoUrl).toBeNull();
    expect(fs.existsSync(storedFile(upload.body.profilePhotoUrl))).toBe(false);
    expect(filesFor(user.id)).toEqual([]);
    const me = await agent.get("/api/users/me");
    expect(me.body.user.profilePhotoUrl).toBeNull();
  });

  it("succeeds when there is no photo", async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, uniqueUser("photo_delete_none"));

    const res = await agent.delete("/api/users/me/photo");

    expect(res.status).toBe(200);
    expect(res.body.profilePhotoUrl).toBeNull();
  });
});
