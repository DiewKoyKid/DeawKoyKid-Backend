-- Providers can book trips of their own, so registering as a provider now also
-- creates a customer profile. Give the same profile to providers who registered
-- before that, otherwise their accounts can't reach the customer side at all.
INSERT INTO "customers" ("userId")
SELECT p."userId"
FROM "providers" p
LEFT JOIN "customers" c ON c."userId" = p."userId"
WHERE c."userId" IS NULL;
