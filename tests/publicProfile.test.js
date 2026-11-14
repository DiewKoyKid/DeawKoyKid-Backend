require("dotenv").config();
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");

// GET /api/users/:id (US3-3): public fields only, plus reviews and published
// services on a provider's profile.

const RUN = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const createdUserIds = [];
const createdServiceIds = [];

// Every private field filled in, so a leak would show up in the response.
async function createUser(name, profiles) {
  const user = await prisma.user.create({
    data: {
      username: `pp_${name}_${RUN}`,
      email: `pp_${name}_${RUN}@example.com`,
      password: "not-used",
      firstname: name,
      lastname: "Tester",
      gender: "F",
      phoneNumber: "0812345678",
      bankAccount: "1234567890",
      ...profiles,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createService(providerId, title, isPublished = true) {
  const service = await prisma.service.create({
    data: { providerId, title, location: "Bangkok", rate: 450, isPublished },
  });
  createdServiceIds.push(service.id);
  return service;
}

async function createReview(serviceId, customerId, rating, comment, timestamp) {
  const booking = await prisma.booking.create({
    data: {
      serviceId,
      customerId,
      bookingDate: new Date("2026-10-01"),
      appointmentDate: new Date("2026-10-10"),
      bookingStatus: "COMPLETED",
    },
  });
  return prisma.review.create({
    data: { bookingId: booking.id, customerId, rating, comment, timestamp },
  });
}

let provider;
let customer;
let published;
let draft;
let olderReview;
let newerReview;

beforeAll(async () => {
  provider = await createUser("Nina", {
    provider: {
      create: {
        idCard: "1234567890123",
        emergencyContactName: "Mom",
        emergencyContactPhone: "0898765432",
        bio: "Food guide",
        languages: "Thai, English",
      },
    },
  });
  customer = await createUser("Ben", { customer: { create: {} } });

  published = await createService(provider.id, "Old Town street food walk");
  draft = await createService(provider.id, "Draft night tour", false);

  // One review on each service: draft services still have reviews from before
  olderReview = await createReview(published.id, customer.id, 4, "Great food", new Date("2026-10-11T10:00:00Z"));
  newerReview = await createReview(draft.id, customer.id, 5, "Loved it", new Date("2026-10-20T10:00:00Z"));
});

afterAll(async () => {
  // Reviews, bookings and services don't cascade from users, so remove them first
  await prisma.review.deleteMany({ where: { booking: { serviceId: { in: createdServiceIds } } } });
  await prisma.booking.deleteMany({ where: { serviceId: { in: createdServiceIds } } });
  await prisma.service.deleteMany({ where: { id: { in: createdServiceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("GET /api/users/:id public profile (US3-3)", () => {
  it.each([["provider"], ["customer"]])("leaves out private fields on a %s's profile", async (who) => {
    const user = who === "provider" ? provider : customer;
    const res = await request(app).get(`/api/users/${user.id}`);

    expect(res.status).toBe(200);
    for (const field of ["email", "gender", "phoneNumber", "bankAccount", "password", "bdate"]) {
      expect(res.body.user).not.toHaveProperty(field);
    }
    if (res.body.user.provider) {
      for (const field of ["idCard", "emergencyContactName", "emergencyContactPhone"]) {
        expect(res.body.user.provider).not.toHaveProperty(field);
      }
    }
  });

  it("returns all reviews on the provider's services, newest first", async () => {
    const res = await request(app).get(`/api/users/${provider.id}`);

    expect(res.body.user.reviews).toEqual([
      {
        id: newerReview.id,
        author: "Ben",
        rating: 5,
        comment: "Loved it",
        date: "2026-10-20T10:00:00.000Z",
        serviceTitle: "Draft night tour",
      },
      {
        id: olderReview.id,
        author: "Ben",
        rating: 4,
        comment: "Great food",
        date: "2026-10-11T10:00:00.000Z",
        serviceTitle: "Old Town street food walk",
      },
    ]);
  });

  it("returns only published services, in the search result shape", async () => {
    const res = await request(app).get(`/api/users/${provider.id}`);

    expect(res.body.user.services).toEqual([
      {
        id: published.id,
        title: "Old Town street food walk",
        location: "Bangkok",
        rate: 450,
        rateUnit: null,
        coverPhotoUrl: null,
        provider: {
          id: provider.id,
          firstname: "Nina",
          lastname: "Tester",
          profilePhotoUrl: null,
          avgRating: 4,
        },
        avgRating: 4,
        reviewCount: 1,
      },
    ]);
    expect(res.body.user.services.map((s) => s.id)).not.toContain(draft.id);
  });

  it("gives a customer's profile no reviews or services", async () => {
    const res = await request(app).get(`/api/users/${customer.id}`);

    expect(res.status).toBe(200);
    expect(res.body.user.provider).toBeNull();
    expect(res.body.user).not.toHaveProperty("reviews");
    expect(res.body.user).not.toHaveProperty("services");
  });

  it("still returns 404 for a deleted provider", async () => {
    const gone = await createUser("Gone", { provider: { create: {} }, deletedAt: new Date() });

    const res = await request(app).get(`/api/users/${gone.id}`);

    expect(res.status).toBe(404);
  });
});
