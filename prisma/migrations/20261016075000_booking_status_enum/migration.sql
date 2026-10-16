-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM (
    'WAITING_FOR_CONFIRMATION',
    'CONFIRMED',
    'REJECTED',
    'EXPIRED',
    'CANCELLED',
    'COMPLETED'
);

ALTER TABLE "bookings"
    ALTER COLUMN "bookingStatus" TYPE "BookingStatus"
    USING (
        CASE upper(replace(trim("bookingStatus"), ' ', '_'))
            WHEN 'WAITING_FOR_CONFIRMATION' THEN 'WAITING_FOR_CONFIRMATION'
            WHEN 'PENDING'                  THEN 'WAITING_FOR_CONFIRMATION'
            WHEN 'CONFIRMED'                THEN 'CONFIRMED'
            WHEN 'REJECTED'                 THEN 'REJECTED'
            WHEN 'EXPIRED'                  THEN 'EXPIRED'
            WHEN 'CANCELLED'                THEN 'CANCELLED'
            WHEN 'CANCELED'                 THEN 'CANCELLED'
            WHEN 'COMPLETED'                THEN 'COMPLETED'
            ELSE 'CANCELLED'
        END
    )::"BookingStatus",
    ALTER COLUMN "bookingStatus" SET DEFAULT 'WAITING_FOR_CONFIRMATION';

-- AlterTable
ALTER TABLE "bookings"
    ADD COLUMN "startTime" VARCHAR(5),
    ADD COLUMN "endTime" VARCHAR(5),
    ADD COLUMN "totalPrice" DECIMAL(10,2),
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "bookings_serviceId_appointmentDate_idx" ON "bookings"("serviceId", "appointmentDate");
CREATE INDEX "bookings_customerId_idx" ON "bookings"("customerId");