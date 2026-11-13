-- US7-1: chat messages default to the insert time and are read per booking in time order.
ALTER TABLE "chat_logs" ALTER COLUMN "timestamp" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "chat_logs_bookingId_timestamp_idx" ON "chat_logs"("bookingId", "timestamp");
