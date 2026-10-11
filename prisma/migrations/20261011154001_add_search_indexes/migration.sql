CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CreateIndex
CREATE INDEX "bookings_serviceId_idx" ON "bookings"("serviceId");

-- CreateIndex
CREATE INDEX "providers_avgRating_idx" ON "providers"("avgRating");

-- CreateIndex
CREATE INDEX "reviews_bookingId_idx" ON "reviews"("bookingId");

-- CreateIndex
CREATE INDEX "service_categories_categoryId_idx" ON "service_categories"("categoryId");

-- CreateIndex
CREATE INDEX "services_providerId_idx" ON "services"("providerId");

-- CreateIndex
CREATE INDEX "services_isPublished_idx" ON "services"("isPublished");

-- CreateIndex
CREATE INDEX "services_title_idx" ON "services" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "services_description_idx" ON "services" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "services_location_idx" ON "services" USING GIN ("location" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_firstname_idx" ON "users" USING GIN ("firstname" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "users_lastname_idx" ON "users" USING GIN ("lastname" gin_trgm_ops);

