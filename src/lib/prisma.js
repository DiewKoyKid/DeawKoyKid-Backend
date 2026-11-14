const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX || 5), connectionTimeoutMillis: 5000, statement_timeout: 10000 });
module.exports = new PrismaClient({ adapter });
