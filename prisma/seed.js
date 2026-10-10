require('dotenv').config();
const prisma = require('../src/lib/prisma');

const CATEGORIES = [
  'Food tour',
  'Sightseeing',
  'Photography',
  'Shopping',
  'Nightlife',
  'Nature & Hiking',
  'Concerts & Events',
  'Culture'
];

async function main() {
  console.log('Seeding categories...');
  for (const catName of CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { category: catName }
    });
    
    if (!existing) {
      await prisma.category.create({
        data: {
          category: catName
        }
      });
      console.log(`Created category: ${catName}`);
    } else {
      console.log(`Category already exists: ${catName}`);
    }
  }

  // Find the mock service (01) and assign it "Photography" and "Shopping"
  const service = await prisma.service.findUnique({
    where: { id: "01" }
  });

  if (service) {
    console.log('Found service "01", adding categories...');
    const catPhoto = await prisma.category.findFirst({ where: { category: "Photography" } });
    const catShopping = await prisma.category.findFirst({ where: { category: "Shopping" } });
    
    if (catPhoto) {
      const exists1 = await prisma.serviceCategory.findUnique({
        where: { serviceId_categoryId: { serviceId: "01", categoryId: catPhoto.id } }
      });
      if (!exists1) {
        await prisma.serviceCategory.create({
          data: { serviceId: "01", categoryId: catPhoto.id }
        });
      }
    }
    
    if (catShopping) {
      const exists2 = await prisma.serviceCategory.findUnique({
        where: { serviceId_categoryId: { serviceId: "01", categoryId: catShopping.id } }
      });
      if (!exists2) {
        await prisma.serviceCategory.create({
          data: { serviceId: "01", categoryId: catShopping.id }
        });
      }
    }
    console.log('Service categories updated for service 01.');

    // --- ADD MOCK REVIEW ---
    let mockUser = await prisma.user.findUnique({ where: { username: "mockreviewer" } });
    if (!mockUser) {
      mockUser = await prisma.user.create({
        data: {
          username: "mockreviewer",
          password: "password123",
          firstname: "Alice",
          lastname: "Reviewer",
        }
      });
      await prisma.customer.create({
        data: { userId: mockUser.id }
      });
    }

    const mockBooking = await prisma.booking.findFirst({
      where: { serviceId: "01", customerId: mockUser.id }
    });

    let bookingId;
    if (!mockBooking) {
      const newBooking = await prisma.booking.create({
        data: {
          serviceId: "01",
          customerId: mockUser.id,
          bookingDate: new Date(),
          appointmentDate: new Date(),
          bookingStatus: "COMPLETED"
        }
      });
      bookingId = newBooking.id;
    } else {
      bookingId = mockBooking.id;
    }

    const mockReview = await prisma.review.findFirst({
      where: { bookingId: bookingId }
    });

    if (!mockReview) {
      await prisma.review.create({
        data: {
          bookingId: bookingId,
          customerId: mockUser.id,
          rating: 5,
          comment: "Absolutely amazing experience! The guide was very knowledgeable and the food was delicious. Highly recommend!",
          timestamp: new Date()
        }
      });
      console.log('Added a real mock review for service 01.');
    } else {
      console.log('Mock review already exists.');
    }

    const extraReviewers = [
      { user: "matty123", first: "Matty", rating: 4, comment: "We had an incredible evening exploring Yaowarat Road with Nina. Starting out at Wat Mangkon right at sunset set such a great atmosphere before diving into the busy street food scene." },
      { user: "nene456", first: "Nene", rating: 4, comment: "What really made this experience good was having a guide who is completely fluent in both Thai and English." },
      { user: "clara789", first: "Clara", rating: 5, comment: "It felt like walking around with a local friend who knows all the best spots. Highly recommend this to anyone visiting Bangkok!" }
    ];

    for (const rev of extraReviewers) {
      let u = await prisma.user.findUnique({ where: { username: rev.user } });
      if (!u) {
        u = await prisma.user.create({
          data: { username: rev.user, password: "password123", firstname: rev.first, lastname: "Reviewer" }
        });
        await prisma.customer.create({ data: { userId: u.id } });
      }

      const b = await prisma.booking.findFirst({ where: { serviceId: "01", customerId: u.id } });
      let bId;
      if (!b) {
        const newB = await prisma.booking.create({
          data: { serviceId: "01", customerId: u.id, bookingDate: new Date(), appointmentDate: new Date(), bookingStatus: "COMPLETED" }
        });
        bId = newB.id;
      } else {
        bId = b.id;
      }

      const r = await prisma.review.findFirst({ where: { bookingId: bId } });
      if (!r) {
        await prisma.review.create({
          data: { bookingId: bId, customerId: u.id, rating: rev.rating, comment: rev.comment, timestamp: new Date() }
        });
        console.log(`Added extra review for ${rev.first}`);
      }
    }
    // -----------------------
  }

  // --- ADD SECOND SERVICE (0 reviews) ---
  const host = await prisma.provider.findFirst();
  if (host) {
    const s2 = await prisma.service.findFirst({ where: { id: "02" } });
    if (!s2) {
      await prisma.service.create({
        data: {
          id: "02",
          providerId: host.userId,
          title: "Morning Run at Benjakitti Park",
          description: "Start your morning with a refreshing 5k run through the beautiful trails of Benjakitti Park. Suitable for all paces!",
          location: "Benjakitti Park, Bangkok",
          rate: 200.00,
          rateUnit: "hour",
          startTime: "06:00:00",
          endTime: "08:00:00",
          coverPhotoUrl: "http://localhost:8081/uploads/services-cover-photo/service002.jpg",
          isPublished: true,
        }
      });
      console.log('Created Morning Run service (02).');
    } else {
      console.log('Morning Run service already exists.');
    }
  }
  // --------------------------------------

  console.log('Seeding finished.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
