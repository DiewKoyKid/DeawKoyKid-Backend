-- AlterTable
ALTER TABLE "reviews" ALTER COLUMN "timestamp" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "reviews_bookingId_key" ON "reviews"("bookingId");

-- Added by hand: Prisma can't express CHECK constraints in the schema.
-- AddCheckConstraint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
