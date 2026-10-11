const prisma = require("../lib/prisma");

// GET /api/categories
async function getCategories(req, res) {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { category: 'asc' }
    });
    return res.status(200).json({ categories });
  } catch (err) {
    console.error("getCategories error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { getCategories };

