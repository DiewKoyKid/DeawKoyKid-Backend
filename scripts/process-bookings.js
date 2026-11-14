require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { expireUnansweredBookings } = require('../src/services/bookingExpiry.service');
const { startConfirmedBookings } = require('../src/services/bookingProgress.service');
(async () => {
 try { console.log(JSON.stringify({expired: await expireUnansweredBookings(), started: await startConfirmedBookings()})); }
 catch { console.error('Booking maintenance failed'); process.exitCode = 1; }
 finally { await prisma.$disconnect(); }
})();
