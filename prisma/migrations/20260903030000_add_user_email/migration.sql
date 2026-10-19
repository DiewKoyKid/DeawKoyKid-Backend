-- Keep this column nullable so existing users can be migrated safely.
-- The registration API requires email for every newly-created user.
ALTER TABLE "users" ADD COLUMN "email" VARCHAR(254);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
