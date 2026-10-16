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

async function createProvider(name, gender, age, avgRating) {
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

  const ann = await createProvider("Ann", "F", 25, 4.8);
  const bob = await createProvider("Bob", "M", 32, 4.2);
  const cat = await createProvider("Cat", "F", 41, 3.5);
  const dee = await createProvider("Dee", "O", 28, null);

  await createService(ann.id, "temple tour", 500, [FOOD]);
  await createService(ann.id, "cooking class", 1200, [FOOD, CULTURE]);
  await createService(bob.id, "photo walk", 800, [PHOTO]);
  await createService(cat.id, "night market", 300, [FOOD, PHOTO]);
  await createService(dee.id, "museum day", 700, [CULTURE]);
});

afterAll(async () => {
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

  it("leaves out providers without a rating once minRating is set", async () => {
    const { titles } = await search({ interests: CULTURE, minRating: 0 });
    expect(titles).toEqual(["cooking class"]);
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
