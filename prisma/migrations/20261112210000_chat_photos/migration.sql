ALTER TABLE "chat_logs"
ADD COLUMN "imageData" BYTEA,
ADD COLUMN "imageMimeType" TEXT;

ALTER TABLE "chat_logs" ADD CONSTRAINT "chat_image_valid"
CHECK (("imageData" IS NULL AND "imageMimeType" IS NULL) OR
       ("imageData" IS NOT NULL AND "imageMimeType" IS NOT NULL AND
        "imageMimeType" IN ('image/jpeg', 'image/png') AND
        octet_length("imageData") BETWEEN 1 AND 5242880));
