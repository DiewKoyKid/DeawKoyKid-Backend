-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_bookingId_fkey";

-- DropForeignKey
ALTER TABLE "reports" DROP CONSTRAINT "reports_adminId_fkey";

-- AlterTable
ALTER TABLE "reports" DROP COLUMN "adminId";

-- DropTable
DROP TABLE "admins";

-- DropTable
DROP TABLE "payments";

