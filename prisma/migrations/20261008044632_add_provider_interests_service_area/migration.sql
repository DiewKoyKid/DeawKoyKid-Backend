-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "serviceArea" TEXT[] DEFAULT ARRAY[]::TEXT[];
