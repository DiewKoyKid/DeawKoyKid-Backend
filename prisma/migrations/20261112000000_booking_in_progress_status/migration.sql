-- US6-5: a confirmed booking whose start time has passed
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS' AFTER 'CONFIRMED';
