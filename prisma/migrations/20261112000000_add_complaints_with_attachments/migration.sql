CREATE TYPE "ComplaintCategory" AS ENUM ('PAYMENT', 'CANCELLATION_OR_REFUND', 'PROVIDER_NO_SHOW', 'SERVICE_NOT_AS_DESCRIBED', 'OTHER');
CREATE TYPE "ComplaintStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

CREATE TABLE "complaints" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "ComplaintCategory" NOT NULL,
    "subject" VARCHAR(100) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "complaint_attachments" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "complaint_attachments_sizeBytes_check" CHECK ("sizeBytes" > 0)
);

CREATE INDEX "complaints_bookingId_idx" ON "complaints"("bookingId");
CREATE INDEX "complaints_userId_createdAt_idx" ON "complaints"("userId", "createdAt");
CREATE INDEX "complaints_status_createdAt_idx" ON "complaints"("status", "createdAt");
CREATE UNIQUE INDEX "complaint_attachments_storageKey_key" ON "complaint_attachments"("storageKey");
CREATE INDEX "complaint_attachments_complaintId_idx" ON "complaint_attachments"("complaintId");

ALTER TABLE "complaints" ADD CONSTRAINT "complaints_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaint_attachments" ADD CONSTRAINT "complaint_attachments_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
