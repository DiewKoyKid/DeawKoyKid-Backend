require("dotenv").config();
const request = require("supertest");
const app = require("../src/app");
const prisma = require("../src/lib/prisma");

// Unique names so the tests only ever see their own rows.
const RUN = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const TITLE_PREFIX = `searchtest-${RUN}`;
const createdUserIds = [];
const createdCategoryIds = [];

async function createProvider(gender) {
  const user = await prisma.user.create({
    data: {
      username: `search_${gender}_${RUN}`,
      password: "not-used",
      firstname: `Search${gender}`,
      lastname: "Tester",
      gender,
      provider: { create: {} },
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createService(providerId, title, rate, categoryIds = []) {
  return prisma.service.create({
    data: {
      providerId,
      title: `${TITLE_PREFIX} ${title}`,
      location: "Bangkok",
      rate,
      serviceCategories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
    },
  });
}

// Only this run's services, by title.
async function search(query) {
  const res = await request(app)
    .get("/api/services/search")
    .query({ q: TITLE_PREFIX, limit: 50, ...query });
  return { res, titles: (res.body.data ?? []).map((s) => s.title.replace(`${TITLE_PREFIX} `, "")).sort() };
}

beforeAll(async () => {
  const food = await prisma.category.create({ data: { category: `Food ${RUN}` } });
  const photo = await prisma.category.create({ data: { category: `Photo ${RUN}` } });
  createdCategoryIds.push(food.id, photo.id);

  const female = await createProvider("F");
  const male = await createProvider("M");
  const other = await createProvider("O");

  await createService(female.id, "street food", 450, [food.id]);
  await createService(male.id, "photo walk", 600, [photo.id]);
  await createService(other.id, "night market", 900, [food.id, photo.id]);
});

afterAll(async () => {
  await prisma.service.deleteMany({ where: { providerId: { in: createdUserIds } } });
  await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("GET /api/services/search", () => {
  it("finds this run's services by keyword", async () => {
    const { res, titles } = await search({});
    expect(res.status).toBe(200);
    expect(titles).toEqual(["night market", "photo walk", "street food"]);
    expect(res.body.meta.totalCount).toBe(3);
  });

  it.each([
    ["F", ["street food"]],
    ["M", ["photo walk"]],
    ["O", ["night market"]],
  ])("filters by the gender code %s used in the URL", async (gender, expected) => {
    const { titles } = await search({ gender });
    expect(titles).toEqual(expected);
  });

  it("still accepts the long gender names", async () => {
    const { titles } = await search({ gender: "Female" });
    expect(titles).toEqual(["street food"]);
  });

  it("ignores an unknown gender instead of matching 'Other'", async () => {
    const { titles } = await search({ gender: "X" });
    expect(titles).toEqual(["night market", "photo walk", "street food"]);
  });

  it("filters by category sent as `interests` (the search page's URL parameter)", async () => {
    const { titles } = await search({ interests: `Food ${RUN}` });
    expect(titles).toEqual(["night market", "street food"]);
  });

  it("matches any of several comma-separated categories", async () => {
    const { titles } = await search({ interests: `Food ${RUN},Photo ${RUN}` });
    expect(titles).toEqual(["night market", "photo walk", "street food"]);
  });

  it("still accepts `categories`", async () => {
    const { titles } = await search({ categories: `Photo ${RUN}` });
    expect(titles).toEqual(["night market", "photo walk"]);
  });

  it("combines filters (all must match)", async () => {
    const { titles } = await search({ gender: "O", interests: `Food ${RUN}`, maxPrice: 1000 });
    expect(titles).toEqual(["night market"]);
  });

  it("filters by price range", async () => {
    const { titles } = await search({ minPrice: 500, maxPrice: 800 });
    expect(titles).toEqual(["photo walk"]);
  });
});
