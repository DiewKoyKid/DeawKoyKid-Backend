-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "emergencyContactName" VARCHAR(80),
ADD COLUMN     "emergencyContactPhone" VARCHAR(20),
ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING';
