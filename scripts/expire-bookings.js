require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { expireUnansweredBookings } = require('../src/services/bookingExpiry.service');
(async () => { try { console.log({ expired: await expireUnansweredBookings() }); } catch (error) { console.error(error); process.exitCode = 1; } finally { await prisma.$disconnect(); } })();
