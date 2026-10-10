-- AlterTable
ALTER TABLE "services" ADD COLUMN     "coverPhotoUrl" TEXT,
ADD COLUMN     "endTime" VARCHAR(5),
ADD COLUMN     "rateUnit" VARCHAR(20) NOT NULL DEFAULT 'hour',
ADD COLUMN     "startTime" VARCHAR(5);
