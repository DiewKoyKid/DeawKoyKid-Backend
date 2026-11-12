-- US7-2: a chat message can carry a photo (JPG/PNG, max 5 MB).
ALTER TABLE "chat_logs" ADD COLUMN "imageUrl" TEXT;
