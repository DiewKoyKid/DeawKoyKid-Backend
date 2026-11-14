require("dotenv").config();
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");

// Combinations of the US5-2 filters (F34). Unique names so the tests only ever see their own rows.
const RUN = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const TITLE_PREFIX = `filtertest-${RUN}`;
const FOOD = `Food ${RUN}`;
const PHOTO = `Photo ${RUN}`;
const CULTURE = `Culture ${RUN}`;
const createdUserIds = [];
const createdCategoryIds = [];
const categoryIds = {};

// Born `age` years and a month ago, so the age is exact whatever the day of the run.
function birthdate(age) {
  const today = new Date();
  return new Date(Date.UTC(today.getFullYear() - age, today.getMonth() - 1, 1));
}

async function createProvider(name, gender, age, avgRating = null) {
  const user = await prisma.user.create({
    data: {
      username: `filter_${name}_${RUN}`,
      password: "not-used",
      firstname: name,
      lastname: "Tester",
      gender,
      bdate: birthdate(age),
      provider: { create: { avgRating } },
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createService(providerId, title, rate, categories) {
  return prisma.service.create({
    data: {
      providerId,
      title: `${TITLE_PREFIX} ${title}`,
      location: "Bangkok",
      rate,
      serviceCategories: { create: categories.map((c) => ({ categoryId: categoryIds[c] })) },
    },
  });
}

// Gives a service one completed, reviewed booking per rating. The rating filter
// and sort use these, not the provider's avgRating.
let reviewer;
async function addReviews(service, ratings) {
  for (const rating of ratings) {
    const booking = await prisma.booking.create({
      data: {
        serviceId: service.id,
        customerId: reviewer.id,
        bookingDate: new Date("2026-10-01"),
        appointmentDate: new Date("2026-10-10"),
        bookingStatus: "COMPLETED",
      },
    });
    await prisma.review.create({
      data: { bookingId: booking.id, customerId: reviewer.id, rating },
    });
  }
}

async function search(query) {
  const res = await request(app)
    .get("/api/services/search")
    .query({ q: TITLE_PREFIX, limit: 50, ...query });
  return { res, titles: (res.body.data ?? []).map((s) => s.title.replace(`${TITLE_PREFIX} `, "")).sort() };
}

beforeAll(async () => {
  for (const name of [FOOD, PHOTO, CULTURE]) {
    const category = await prisma.category.create({ data: { category: name } });
    categoryIds[name] = category.id;
    createdCategoryIds.push(category.id);
  }

  reviewer = await prisma.user.create({
    data: {
      username: `filter_reviewer_${RUN}`,
      password: "not-used",
      firstname: "Reviewer",
      lastname: "Tester",
      customer: { create: {} },
    },
  });
  createdUserIds.push(reviewer.id);

  // The providers' own avgRating is deliberately set to the opposite of their
  // services' ratings: filtering and sorting must follow the service's reviews.
  const ann = await createProvider("Ann", "F", 25, 1);
  const bob = await createProvider("Bob", "M", 32, 5);
  const cat = await createProvider("Cat", "F", 41, 5);
  const dee = await createProvider("Dee", "O", 28, 5);

  const templeTour = await createService(ann.id, "temple tour", 500, [FOOD]);
  const cookingClass = await createService(ann.id, "cooking class", 1200, [FOOD, CULTURE]);
  const photoWalk = await createService(bob.id, "photo walk", 800, [PHOTO]);
  const nightMarket = await createService(cat.id, "night market", 300, [FOOD, PHOTO]);
  await createService(dee.id, "museum day", 700, [CULTURE]);

  await addReviews(templeTour, [5, 5]); // 5.0
  await addReviews(cookingClass, [5, 4, 5]); // 4.67
  await addReviews(photoWalk, [4]); // 4.0
  await addReviews(nightMarket, [3, 4]); // 3.5
  // museum day has no reviews
});

afterAll(async () => {
  await prisma.review.deleteMany({ where: { customerId: reviewer.id } });
  await prisma.booking.deleteMany({ where: { customerId: reviewer.id } });
  await prisma.service.deleteMany({ where: { providerId: { in: createdUserIds } } });
  await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("GET /api/services/search with combined filters (US5-2)", () => {
  it.each([
    ["gender + price", { gender: "F", minPrice: 400 }, ["cooking class", "temple tour"]],
    ["gender + age", { gender: "F", maxAge: 30 }, ["cooking class", "temple tour"]],
    ["age + interest", { minAge: 30, interests: FOOD }, ["night market"]],
    ["rating + interest", { minRating: 4, interests: PHOTO }, ["photo walk"]],
    ["price range + interest", { minPrice: 400, maxPrice: 1000, interests: `${FOOD},${CULTURE}` }, ["museum day", "temple tour"]],
    ["age range + rating", { minAge: 20, maxAge: 35, minRating: 4.5 }, ["cooking class", "temple tour"]],
  ])("%s: only services matching every filter", async (_, query, expected) => {
    const { res, titles } = await search(query);
    expect(res.status).toBe(200);
    expect(titles).toEqual(expected);
    expect(res.body.meta.totalCount).toBe(expected.length);
  });

  it("applies all five filters together", async () => {
    const { titles } = await search({
      gender: "F",
      minAge: 20,
      maxAge: 30,
      interests: FOOD,
      minPrice: 1000,
      maxPrice: 1500,
      minRating: 4.5,
    });
    expect(titles).toEqual(["cooking class"]);
  });

  it("returns an empty list, not an error, when the filters match nothing", async () => {
    const { res, titles } = await search({ gender: "M", interests: FOOD });
    expect(res.status).toBe(200);
    expect(titles).toEqual([]);
    expect(res.body.meta.totalCount).toBe(0);
  });

  it("counts every match in totalCount, not just the current page", async () => {
    const { res } = await search({ interests: FOOD, limit: 1 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.totalCount).toBe(3);
    expect(res.body.meta.totalPages).toBe(3);
  });

  it("leaves out services without a review once minRating is set", async () => {
    const { titles } = await search({ interests: CULTURE, minRating: 0 });
    expect(titles).toEqual(["cooking class"]);
  });

  it("filters by the service's own average, not the provider's", async () => {
    // Ann's provider avgRating is 1 but her services average 5.0 and 4.67
    const { titles } = await search({ minRating: 4.5 });
    expect(titles).toEqual(["cooking class", "temple tour"]);
    // Cat's provider avgRating is 5 but her only service averages 3.5
    expect((await search({ minRating: 3.5 })).titles).toContain("night market");
    expect((await search({ minRating: 3.6 })).titles).not.toContain("night market");
  });

  it("sorts by the service's own average, with unrated services last", async () => {
    const { res } = await search({ sortBy: "rating_desc" });
    expect(res.body.data.map((s) => s.title.replace(`${TITLE_PREFIX} `, ""))).toEqual([
      "temple tour",
      "cooking class",
      "photo walk",
      "night market",
      "museum day",
    ]);
    expect(res.body.data.map((s) => s.avgRating)).toEqual([5, 4.67, 4, 3.5, null]);
  });

  it("pages the rating sort in order and keeps totalCount", async () => {
    const first = await search({ sortBy: "rating_desc", limit: 2, page: 1 });
    const second = await search({ sortBy: "rating_desc", limit: 2, page: 2 });
    const names = (r) => r.res.body.data.map((s) => s.title.replace(`${TITLE_PREFIX} `, ""));
    expect(names(first)).toEqual(["temple tour", "cooking class"]);
    expect(names(second)).toEqual(["photo walk", "night market"]);
    expect(first.res.body.meta).toMatchObject({ totalCount: 5, totalPages: 3, currentPage: 1 });
  });

  it("includes providers exactly at the age bounds", async () => {
    const { titles } = await search({ minAge: 25, maxAge: 25 });
    expect(titles).toEqual(["cooking class", "temple tour"]);
  });

  it("includes services priced exactly at the price bounds", async () => {
    const { titles } = await search({ minPrice: 500, maxPrice: 800 });
    expect(titles).toEqual(["museum day", "photo walk", "temple tour"]);
  });
});
