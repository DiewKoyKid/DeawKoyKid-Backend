const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const request = require("supertest");

process.env.JWT_SECRET = "complaint-tests-only-secret";
jest.mock("../src/lib/prisma", () => ({
  user: { findUnique: jest.fn() },
  booking: { findUnique: jest.fn() },
  complaint: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
  complaintAttachment: { findFirst: jest.fn() },
}));
process.env.COMPLAINT_STORAGE_DIR = require('fs').mkdtempSync(path.join(os.tmpdir(), 'complaint-tests-'));
const attachments = require('../src/utils/complaintAttachments');

const app = require("../src/app");
const prisma = require("../src/lib/prisma");
const { signToken } = require("../src/utils/jwt");
const token = signToken({ userId: "customer-1" });
const adminToken = signToken({ userId: "reviewer-1" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PDF = Buffer.from("%PDF-1.7\n%%EOF\n");
const fields = { bookingId: "booking-1", category: "OTHER", subject: "Help", description: "Please help with this booking" };

function post(overrides = {}) {
  const req = request(app).post("/api/complaints").set("Authorization", `Bearer ${token}`);
  for (const [key, value] of Object.entries({ ...fields, ...overrides })) {
    if (value !== undefined) req.field(key, value);
  }
  return req;
}
function attach(req, bytes = PNG, name = "evidence.png", type = "image/png", field = "attachments") {
  return req.attach(field, bytes, { filename: name, contentType: type });
}
async function expectNoFiles() {
  expect(await fs.readdir(attachments.STORAGE_ROOT)).toEqual([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockImplementation(async ({ where }) => ({
    deletedAt: null,
    isAdmin: where.id === "reviewer-1",
  }));
  prisma.booking.findUnique.mockResolvedValue({ customerId: "customer-1" });
  prisma.complaint.create.mockImplementation(async ({ data }) => ({
    id: "complaint-1", bookingId: data.bookingId, category: data.category,
    subject: data.subject, description: data.description, status: data.status,
    createdAt: new Date(), updatedAt: new Date(),
    attachments: data.attachments.create.map(({ storageKey, ...file }, i) => ({ id: `attachment-${i}`, ...file })),
  }));
});
afterEach(async () => {
  for (const name of await fs.readdir(attachments.STORAGE_ROOT)) {
    const target = path.resolve(attachments.STORAGE_ROOT, name);
    if (path.dirname(target) !== attachments.STORAGE_ROOT) throw new Error("Invalid test cleanup path");
    await fs.rm(target, { recursive: true, force: true });
  }
  jest.restoreAllMocks();
});
afterAll(async () => {
  if (path.dirname(attachments.STORAGE_ROOT) !== path.resolve(os.tmpdir()) || !path.basename(attachments.STORAGE_ROOT).startsWith("complaint-tests-")) {
    throw new Error("Invalid test root");
  }
  await fs.rmdir(attachments.STORAGE_ROOT);
});

describe("Complaint management", () => {
  it("scopes the list and individual complaints to the signed-in customer", async () => {
    prisma.complaint.findMany.mockResolvedValueOnce([]);
    prisma.complaint.findFirst.mockResolvedValueOnce(null);
    const list = await request(app).get("/api/complaints/me").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(prisma.complaint.findMany.mock.calls[0][0].where).toEqual({ userId: "customer-1" });
    const detail = await request(app).get("/api/complaints/other").set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(404);
    expect(prisma.complaint.findFirst.mock.calls[0][0].where).toEqual({ id: "other", userId: "customer-1" });
  });

  it("does not expose attachments outside the customer's complaint", async () => {
    prisma.complaintAttachment.findFirst.mockResolvedValueOnce(null);
    const res = await request(app).get("/api/complaints/other/attachments/file")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(prisma.complaintAttachment.findFirst.mock.calls[0][0].where).toEqual({
      id: "file", complaintId: "other", complaint: { userId: "customer-1" },
    });
  });

  it("denies the admin queue to regular customers", async () => {
    const res = await request(app).get("/api/complaints/admin").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(prisma.complaint.findMany).not.toHaveBeenCalled();
  });

  it("updates the reply and status only against the version the reviewer saw", async () => {
    const version = "2026-11-12T08:00:00.000Z";
    const update = { expectedStatus: "PENDING", expectedUpdatedAt: version, status: "IN_PROGRESS", adminReply: " Looking into this. " };
    prisma.complaint.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    prisma.complaint.findFirst.mockResolvedValueOnce({ id: "case", status: "IN_PROGRESS", adminReply: "Looking into this." });
    const patch = () => request(app).patch("/api/complaints/admin/case")
      .set("Authorization", `Bearer ${adminToken}`).send(update);
    const saved = await patch();
    expect(saved.status).toBe(200);
    expect(saved.body.complaint.adminReply).toBe("Looking into this.");
    expect(prisma.complaint.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "case", status: "PENDING", updatedAt: new Date(version) },
      data: { status: "IN_PROGRESS", adminReply: "Looking into this." },
    });
    expect((await patch()).status).toBe(409);
  });
});

describe("POST /api/complaints", () => {
  it("requires authentication before accepting files", async () => {
    const res = await attach(request(app).post("/api/complaints"));
    expect(res.status).toBe(401);
    await expectNoFiles();
  });
  it.each([null, { deletedAt: new Date() }])("rejects unavailable accounts: %p", async (user) => {
    prisma.user.findUnique.mockResolvedValue(user);
    expect((await attach(post())).status).toBe(401);
    await expectNoFiles();
  });
  it("requires multipart", async () => {
    const res = await request(app).post("/api/complaints").set("Authorization", `Bearer ${token}`).send(fields);
    expect(res.status).toBe(415);
  });
  it("creates without attachments and trims text, with cookie authentication", async () => {
    const req = request(app).post("/api/complaints").set("Cookie", `token=${token}`);
    for (const [key, value] of Object.entries(fields)) req.field(key, ` ${value} `);
    const res = await req;
    expect(res.status).toBe(201);
    expect(res.body.complaint).toMatchObject({ ...fields, status: "PENDING", attachments: [] });
    expect(prisma.complaint.create.mock.calls[0][0].data.userId).toBe("customer-1");
    await expectNoFiles();
  });
  it("stores multiple private files with metadata in one nested create", async () => {
    const res = await attach(attach(attach(post()), JPEG, "photo.jpeg", "image/jpeg"), PDF, "proof.pdf", "application/pdf");
    expect(res.status).toBe(201);
    expect(res.body.complaint.attachments).toHaveLength(3);
    expect(prisma.complaint.create).toHaveBeenCalledTimes(1);
    const files = prisma.complaint.create.mock.calls[0][0].data.attachments.create;
    for (const [i, file] of files.entries()) {
      expect(await fs.readFile(path.join(attachments.STORAGE_ROOT, file.storageKey))).toEqual([PNG, JPEG, PDF][i]);
      expect(res.body.complaint.attachments[i]).not.toHaveProperty("storageKey");
      expect((await request(app).get(`/uploads/${file.storageKey}`)).status).toBe(404);
    }
  });
  it.each(Object.keys(fields))("requires %s and removes uploaded files", async (field) => {
    expect((await attach(post({ [field]: undefined }))).status).toBe(400);
    expect(prisma.complaint.create).not.toHaveBeenCalled();
    await expectNoFiles();
  });
  it.each([
    { subject: "   " }, { description: "  " }, { category: "INVALID" },
    { subject: "a".repeat(101) }, { description: "a".repeat(2001) },
  ])("rejects invalid fields %p", async (overrides) => {
    expect((await attach(post(overrides))).status).toBe(400);
    await expectNoFiles();
  });
  it("accepts exact text limits including Unicode", async () => {
    expect((await post({ subject: "😀".repeat(100), description: "ก".repeat(2000) })).status).toBe(201);
  });
  it("rejects repeated fields", async () => {
    expect((await post().field("subject", "again")).status).toBe(400);
    await expectNoFiles();
  });
  it.each(["userId", "status"])("rejects client-controlled %s", async (field) => {
    expect((await post({ [field]: "spoofed" })).status).toBe(400);
    expect(prisma.complaint.create).not.toHaveBeenCalled();
    await expectNoFiles();
  });
  it.each([[null, 404], [{ customerId: "someone-else" }, 403]])("checks booking access %p", async (booking, status) => {
    prisma.booking.findUnique.mockResolvedValue(booking);
    expect((await attach(post())).status).toBe(status);
    expect(prisma.complaint.create).not.toHaveBeenCalled();
    await expectNoFiles();
  });
  it.each([
    [Buffer.from("fake"), "evidence.png", "image/png"],
    [PNG, "evidence.pdf", "application/pdf"],
    [PNG, "evidence.txt", "image/png"],
    [PNG, "evidence.png", "text/plain"],
    [Buffer.alloc(0), "empty.png", "image/png"],
    [PNG, `${"a".repeat(252)}.png`, "image/png"],
  ])("rejects invalid attachments %# and cleans previous files", async (bytes, name, type) => {
    expect((await attach(attach(post()), bytes, name, type)).status).toBe(400);
    expect(prisma.complaint.create).not.toHaveBeenCalled();
    await expectNoFiles();
  });
  it("rejects unexpected file fields", async () => {
    expect((await attach(post(), PNG, "photo.png", "image/png", "photo")).status).toBe(400);
    await expectNoFiles();
  });
  it("accepts five files", async () => {
    let req = post();
    for (let i = 0; i < 5; i++) req = attach(req);
    expect((await req).status).toBe(201);
  });
  it("rejects six files and removes all uploads", async () => {
    let req = post();
    for (let i = 0; i < 6; i++) req = attach(req);
    expect((await req).status).toBe(400);
    await expectNoFiles();
  });
  it.each([[0, 201], [1, 413]])("checks the exact 10 MiB boundary plus %i bytes", async (extra, status) => {
    const bytes = Buffer.alloc(attachments.MAX_BYTES + extra);
    PNG.copy(bytes);
    expect((await attach(post(), bytes)).status).toBe(status);
    if (status !== 201) await expectNoFiles();
  });
  it("cleans persisted files if the database write fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    prisma.complaint.create.mockRejectedValue(new Error("private database detail"));
    const res = await attach(post());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    await expectNoFiles();
  });
  it("cleans temporary files if moving to permanent storage fails", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(fs, "rename").mockRejectedValueOnce(new Error("disk failure"));
    const res = await attach(post());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    expect(prisma.complaint.create).not.toHaveBeenCalled();
    await expectNoFiles();
  });
  it("rejects malformed multipart and cleans temporary directories", async () => {
    const res = await request(app).post("/api/complaints").set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "multipart/form-data; boundary=broken").send("--broken\r\n");
    expect(res.status).toBe(400);
    await expectNoFiles();
  });
});

