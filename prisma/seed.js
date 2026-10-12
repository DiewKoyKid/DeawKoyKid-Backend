require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { hashPassword } = require("../src/utils/hash");

// Every sample account signs in with this password. Stored hashed, like real
// accounts, so login (bcrypt compare) works for them.
const SAMPLE_PASSWORD = "password123";

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
          password: await hashPassword(SAMPLE_PASSWORD),
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
          data: { username: rev.user, password: await hashPassword(SAMPLE_PASSWORD), firstname: rev.first, lastname: "Reviewer" }
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

  // --- ADD NEW PROVIDERS AND 8 MORE SERVICES ---
  
  const providersData = [
    { user: "somchai_guide", first: "Somchai", last: "Guide" },
    { user: "kanya_explore", first: "Kanya", last: "Explore" },
    { user: "nat_tours", first: "Nat", last: "Tours" }
  ];

  const providerMap = {};
  for (const pd of providersData) {
    let u = await prisma.user.findUnique({ where: { username: pd.user } });
    if (!u) {
      u = await prisma.user.create({
        data: { username: pd.user, password: await hashPassword(SAMPLE_PASSWORD), firstname: pd.first, lastname: pd.last }
      });
      await prisma.provider.create({ data: { userId: u.id } });
    }
    providerMap[pd.user] = u.id;
  }
  
  if (host) {
    providerMap["host"] = host.userId;
  }

  const servicesData = [
    {
      id: "03", providerId: providerMap["somchai_guide"], title: "Bang Rak Night Food Crawl",
      desc: "Taste the best local street food in Bang Rak area.", loc: "Bang Rak, Bangkok",
      rate: 500, rateUnit: "hour", start: "18:00:00", end: "22:00:00",
      cats: ["Food tour", "Nightlife"], cover: "service003.jpg"
    },
    {
      id: "04", providerId: providerMap["kanya_explore"], title: "Chinatown Street Photography",
      desc: "Explore Yaowarat with a local photographer and capture the vibrant street life.", loc: "Yaowarat, Bangkok",
      rate: 600, rateUnit: "hour", start: "17:00:00", end: "20:00:00",
      cats: ["Photography", "Culture"], cover: "service004.jpg"
    },
    {
      id: "05", providerId: providerMap["nat_tours"], title: "Grand Palace & Temple Tour",
      desc: "Discover the rich history of Bangkok by visiting the Grand Palace and nearby temples.", loc: "Phra Nakhon, Bangkok",
      rate: 800, rateUnit: "hour", start: "09:00:00", end: "14:00:00",
      cats: ["Sightseeing", "Culture"], cover: "service005.jpg"
    },
    {
      id: "06", providerId: providerMap["somchai_guide"], title: "Chatuchak Weekend Shopping Spree",
      desc: "Get the best deals and navigate the massive Chatuchak market with a local.", loc: "Chatuchak, Bangkok",
      rate: 400, rateUnit: "hour", start: "10:00:00", end: "16:00:00",
      cats: ["Shopping"], cover: "service006.jpg"
    },
    {
      id: "07", providerId: providerMap["kanya_explore"], title: "Khao Yai Nature Hiking",
      desc: "A full day hiking trip in Khao Yai National Park.", loc: "Khao Yai National Park",
      rate: 1200, rateUnit: "day", start: "07:00:00", end: "19:00:00",
      cats: ["Nature & Hiking"], cover: "service007.jpg"
    },
    {
      id: "08", providerId: providerMap["nat_tours"], title: "Sukhumvit Nightlife Guide",
      desc: "Experience the best bars and clubs in Sukhumvit.", loc: "Sukhumvit, Bangkok",
      rate: 900, rateUnit: "hour", start: "21:00:00", end: "02:00:00",
      cats: ["Nightlife"], cover: "service008.jpg"
    },
    {
      id: "09", providerId: providerMap["host"], title: "Local Indie Concert Buddy",
      desc: "Looking for someone to go to an indie concert with? I'm your buddy!", loc: "RCA, Bangkok",
      rate: 350, rateUnit: "event", start: "19:00:00", end: "23:00:00",
      cats: ["Concerts & Events"], cover: "service009.jpg"
    },
    {
      id: "10", providerId: providerMap["somchai_guide"], title: "Ayutthaya Historical Sightseeing",
      desc: "A day trip to the ancient city of Ayutthaya.", loc: "Ayutthaya",
      rate: 1500, rateUnit: "day", start: "08:00:00", end: "18:00:00",
      cats: ["Sightseeing", "Culture"], cover: "service010.jpg"
    }
  ];

  for (const s of servicesData) {
    if (!s.providerId) continue; // safety check
    const existing = await prisma.service.findFirst({ where: { id: s.id } });
    if (!existing) {
      await prisma.service.create({
        data: {
          id: s.id,
          providerId: s.providerId,
          title: s.title,
          description: s.desc,
          location: s.loc,
          rate: s.rate,
          rateUnit: s.rateUnit,
          startTime: s.start,
          endTime: s.end,
          coverPhotoUrl: `http://localhost:8081/uploads/services-cover-photo/${s.cover}`,
          isPublished: true,
        }
      });
      console.log(`Created service: ${s.title}`);

      for (const catName of s.cats) {
        const cat = await prisma.category.findFirst({ where: { category: catName } });
        if (cat) {
          await prisma.serviceCategory.create({
            data: { serviceId: s.id, categoryId: cat.id }
          });
        }
      }
    } else {
      console.log(`Service already exists: ${s.title}`);
    }
  }

  const topPickServices = ["04", "05", "08", "10"];
  let mockUser2 = await prisma.user.findUnique({ where: { username: "mockreviewer" } });
  
  if (mockUser2) {
    for (const sid of topPickServices) {
      const b = await prisma.booking.findFirst({ where: { serviceId: sid, customerId: mockUser2.id } });
      let bId;
      if (!b) {
        const newB = await prisma.booking.create({
          data: { serviceId: sid, customerId: mockUser2.id, bookingDate: new Date(), appointmentDate: new Date(), bookingStatus: "COMPLETED" }
        });
        bId = newB.id;
      } else {
        bId = b.id;
      }

      const r = await prisma.review.findFirst({ where: { bookingId: bId } });
      if (!r) {
        await prisma.review.create({
          data: { bookingId: bId, customerId: mockUser2.id, rating: 5, comment: "Amazing experience! Highly recommended.", timestamp: new Date() }
        });
        console.log(`Added 5-star review for service ${sid}`);
      }
    }
  }

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
