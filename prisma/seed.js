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
