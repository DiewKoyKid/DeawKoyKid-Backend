-- Reuse the preference if it already exists in a development database.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;
