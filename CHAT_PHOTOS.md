# Booking chat photos (Garfield, US7-2)

Built on Max's `feat/us7-1-chat`. Apply migrations and regenerate the client:

```sh
npm install
npx prisma migrate deploy --config prisma7.config.ts
npx prisma generate --config prisma7.config.ts
npm test -- --runTestsByPath tests/chat.test.js tests/chatPhoto.integration.test.js
```

Restart the API after migration. The integration test uses the configured PostgreSQL
database and removes only its own fixtures.

## API

- `POST /api/bookings/:id/messages/image`: authenticated multipart upload, one
  `image` file and optional `content` caption (up to 2,000 characters). Accepts
  JPEG/PNG only, at most 5 MiB (5,242,880 bytes); checks MIME type and file signature.
  Returns `201 { message }` and broadcasts the same message through `chat:message`.
  Uploading sends the message; no separate socket send is needed.
- `GET /api/bookings/:id/messages/:messageId/image`: returns image bytes after
  checking booking participation. Requires the login cookie or bearer token.
- History and socket messages now include nullable `imageUrl`. Binary data is
  excluded from history/socket payloads. Existing text messages are unchanged.
- Missing authentication: 401; outsider or disallowed booking status: 403;
  missing booking/photo: 404; invalid file, size, or caption: 400.

Only the booking's customer/provider can upload, and only while CONFIRMED.
Preserves Max's completed-booking behavior: COMPLETED history/photos remain
readable; sending is disabled. Other statuses cannot access chat.

Images are stored atomically with messages in PostgreSQL (`BYTEA`) and served
through the protected API, never the public uploads directory. This avoids orphan
uploads and separate file-volume setup; database size/backups grow with photos.
The frontend previews locally before sending, supports removal and captions,
and retains the selection on failure. Click a sent thumbnail to open the image.
