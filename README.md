# 🛵 Travel Companion Matchmaking System — Backend API

Backend RESTful API service สำหรับระบบค้นหาและจับคู่เพื่อนเที่ยว ทำหน้าที่จัดการระบบสมาชิก, การเข้าสู่ระบบ (Authentication & Authorization), การจัดการโปรไฟล์ และการประมวลผลข้อมูลการจับคู่คู่เดินทาง

## 🛠 Tech Stack
* **Runtime Environment:** Node.js
* **Framework:** Express.js
* **Database:** PostgreSQL
* **Authentication:** JSON Web Tokens (JWT) & bcrypt
* **Validation & Tooling:** Express-validator, Nodemon, dotenv

## ✨ Key Features (Sprint 1)
* **Authentication & Authorization:** ระบบลงทะเบียนและเข้าสู่ระบบสำหรับ Customer และ Provider
* **Privacy & Consent:** การบันทึกและจัดการการยินยอมนโยบายความเป็นส่วนตัวและเงื่อนไขการใช้งาน
* **Profile Management:** API สำหรับเรียกดูและอัปเดตข้อมูลโปรไฟล์ผู้ใช้งาน

## Complaint storage

`Complaint` links a booking and submitting user to a category, subject (100
characters), description (2,000 characters), and status (`PENDING` by default).
`ComplaintAttachment` supports multiple files per complaint, storing the original
filename, unique durable storage key, MIME type, positive byte size, and upload
timestamp. File contents are stored separately from the database.

Apply the migration with `npx prisma migrate deploy --config prisma7.config.ts`
and regenerate the client with `npx prisma generate --config prisma7.config.ts`.
Deleting a complaint cascades to its attachment rows; storage cleanup must also
remove the actual files. User and booking deletion is restricted while complaints
reference them.

## Create complaint API

Customers can list their complaints at `GET /api/complaints/me`, open one at
`GET /api/complaints/:id`, and download its attachments while signed in.
The web app provides **My complaints** and **View reported issues** in My bookings.

To appoint a complaint admin, apply migrations, run
`npx prisma studio --config prisma7.config.ts`, and set `User.isAdmin` to
`true` on the intended active account. Use an individually assigned account
and verify its user ID before granting access. Set the field back to `false`
to revoke access. The backend checks the current database value on each
complaint admin request. All accounts default to false, including accounts
previously configured through `COMPLAINT_ADMIN_USER_IDS`.

Admins sign in on the regular login page with their own username or email and
password. The login response includes the `ADMIN` role and the frontend opens
`/admin/complaints`, where admins can reply and move complaints from Pending
review to In progress and then Resolved. Existing signed-in accounts can sign
in again to refresh the roles stored in the frontend.

`POST /api/complaints` requires the login cookie or a Bearer token and
`multipart/form-data`. Required text fields are `bookingId`, `category`, `subject`
(1–100 characters), and `description` (1–2,000 characters). Text is trimmed.
Categories: `PAYMENT`, `CANCELLATION_OR_REFUND`, `PROVIDER_NO_SHOW`,
`SERVICE_NOT_AS_DESCRIBED`, `OTHER`. Unknown and repeated fields are rejected.
The server sets `userId` from authentication and `status` to `PENDING`.

Only the booking's customer may submit. All booking statuses are eligible and
multiple complaints per booking are allowed. Attachments are optional: use the
repeated `attachments` field for up to 5 JPG/JPEG, PNG, or PDF files, each nonempty
and at most 10 MiB (10,485,760 bytes). Extensions, MIME types, and file signatures
must match. Signature validation is not a full document parser or malware scan.

Files are stored outside public uploads in `storage/complaints/` by default.
`COMPLAINT_STORAGE_DIR` can point to a private persistent disk directory; do not
place it beneath a publicly served directory. File and database backups must be
kept together. This endpoint returns metadata, not a public URL or storage key;
authenticated file retrieval is not implemented yet.

Example (replace the token, booking ID and local file path):

```sh
curl -X POST http://localhost:8080/api/complaints \
  -H "Authorization: Bearer <token>" \
  -F "bookingId=<booking-id>" \
  -F "category=OTHER" \
  -F "subject=Booking issue" \
  -F "description=Please help with this booking" \
  -F "attachments=@evidence.png;type=image/png"
```

Success: `201` with `{ "complaint": { "id", "bookingId", "category", "subject",
"description", "status", "createdAt", "updatedAt", "attachments": [ { "id",
"originalName", "mimeType", "sizeBytes" } ] }`.
Errors use `{ "error": "..." }`: `400` invalid fields/files/count or malformed
multipart, `401` missing/invalid login or unavailable account, `403` another
customer's booking, `404` missing booking, `413` oversized file, `415` wrong
request content type, `500` storage/database failure.

Complaint and attachment rows are created atomically. Failed requests clean up
temporary or moved files; cleanup failures are logged. Filesystem operations are
not transactional with PostgreSQL, so process crashes can still leave orphaned
files. A successful POST retry creates another complaint (no idempotency key).

Run endpoint tests with `npm test -- --runTestsByPath tests/complaint.test.js`.
They use real authentication, multipart parsing and isolated disk storage, with
Prisma mocked so they do not modify an application database.

## Booking status API

`PATCH /api/bookings/:id/status` requires authentication (the login cookie or a
Bearer token). Only the provider who owns the booking's service may decide a request.

Send `{ "status": "CONFIRMED" }` to accept or `{ "status": "REJECTED" }` to reject.
A successful request returns `200` with `{ "booking": { ... } }` and creates an
in-app notification for the customer. Repeating the same decision returns `200`
without another notification. Other transitions require `WAITING_FOR_CONFIRMATION`.

Errors: `400` for an invalid status, `401` without valid authentication, `403` for
another user, `404` for a missing booking, and `409` for a conflicting decision or
an expired/cancelled/completed booking.

Unanswered requests expire exactly 24 hours after `createdAt` (elapsed time,
independent of calendar dates or time zones). At or after that deadline, a provider
decision commits `EXPIRED` and returns `409` with `"This request has expired"`.
Both parties receive one in-app expiry notification. Already answered bookings
keep their status.

The server also checks for expired requests at startup and every minute, so
unanswered requests expire without a provider action and release their slots.
Background updates can lag the deadline by one polling interval; provider decisions
always enforce the cutoff immediately. Apply migrations with `npx prisma migrate deploy --config prisma7.config.ts`
to add the expiry lookup index.

## My bookings API

`GET /api/bookings/me` requires authentication and returns the caller's bookings
as the customer for the "My bookings" page:
`{ "upcoming": [...], "past": [...] }`. `upcoming` holds bookings that are
`WAITING_FOR_CONFIRMATION` or `CONFIRMED` and haven't started yet, soonest first;
everything else (started or `IN_PROGRESS`, cancelled, rejected, expired,
completed) is in `past`, most recent first.

Each item has `id`, `bookingStatus`, `bookingDate`, `appointmentDate`,
`startTime`, `endTime`, `duration`, `totalPrice`, `createdAt`, `startsAt` (ISO
time the booking begins), `endsAt` (ISO time it ends: the slot's `endTime`, or
midnight the next day for a booking without a slot), `canCancel` (the same rule
as the cancel endpoint below), `canComplete` (the same rule as the complete
endpoint below), `service: { id, title, location, coverPhotoUrl }` and
`provider: { id, firstname, lastname, profilePhotoUrl }`.

## Booking cancellation API

`PATCH /api/bookings/:id/cancel` requires authentication and takes no body. Only
the customer who made the booking may cancel it, and only while it is `CONFIRMED`
and its booked time hasn't begun yet (the slot's `startTime` on the appointment
date, or midnight for a booking without a slot, in the server's timezone).

A successful request returns `200` with `{ "booking": { ... } }`, sets the status
to `CANCELLED` (which frees the slot), and creates an in-app notification for the
provider. Cancelling an already cancelled booking returns `200` without another
notification.

Errors: `401` without valid authentication, `403` for anyone but the booking's
customer, `404` for a missing booking, and `409` for a booking that isn't
confirmed or has already started.

## Booking progress and completion API (US6-5)

A booking moves `CONFIRMED` → `IN_PROGRESS` → `COMPLETED`:

- **`IN_PROGRESS`**: a background job started with the server checks once a
  minute and moves every `CONFIRMED` booking whose start time has passed to
  `IN_PROGRESS`. Nobody is notified. An `IN_PROGRESS` booking still holds its
  slot and still blocks account deletion.
- **`PATCH /api/bookings/:id/complete`** requires authentication and takes no
  body. Only the booking's customer may call it, and only once the booking is
  `CONFIRMED` or `IN_PROGRESS` and its end time has passed (the job may not have
  run yet, so a confirmed booking that has ended can be completed too). It returns
  `200` with `{ "booking": { ... } }`, sets the status to `COMPLETED` (which
  unlocks `POST /api/reviews`) and notifies the provider.

Errors: `401` without valid authentication, `403` for anyone but the booking's
customer, `404` for a missing booking, and `409` when the booking hasn't ended
yet, is already completed, or isn't confirmed. Apply migrations with
`npx prisma migrate deploy --config prisma7.config.ts` to add the `IN_PROGRESS`
status.

## Reviews API

`POST /api/reviews` requires authentication. The customer of a `COMPLETED`
booking sends `{ "bookingId": "...", "rating": 1-5, "comment": "..." }` to review
it once. `rating` must be a whole number; `comment` is optional, trimmed, at most
1000 characters, and stored as `null` when blank.

A successful request returns `201` with
`{ "review": { "id", "bookingId", "rating", "comment", "timestamp" }, "provider": { "id", "avgRating", "reviewCount" } }`.
In the same transaction the provider's `avgRating` is recalculated as the average
of all reviews on their services, rounded to 2 decimals.

Errors: `400` for an invalid body or a booking that isn't completed yet, `401`
without valid authentication, `403` for another customer's booking, `404` for a
missing booking, and `409` when the booking already has a review. There is no
payment check because the project has no payment step. Apply migrations with
`npx prisma migrate deploy --config prisma7.config.ts` to add the one-review-per-booking
index and the rating check.

### Provider reviews (US8-2)

`GET /api/providers/:id/reviews?page=1&limit=6` is public and returns one page of
the reviews on all of a provider's services, newest first:

```json
{
  "reviews": [{ "id", "author", "rating", "comment", "date", "serviceTitle" }],
  "summary": { "avgRating": 4.3, "reviewCount": 13 },
  "meta": { "totalCount": 13, "currentPage": 1, "totalPages": 3, "limit": 6 }
}
```

`author` is the reviewer's first name only. `summary` covers every review, not
just the page; `avgRating` is rounded to 1 decimal and is `null` when there are
none. `limit` defaults to 6 and is capped at 50; a missing or invalid `page` or
`limit` uses the default, and a page past the end returns the last page. `404`
when the user doesn't exist, was deleted, or isn't a provider.

## In-app notifications API

Authenticated users can list their notifications with `GET /api/notifications`.
The response is `{ "notifications": [...] }`, ordered newest first. Each item
includes its ID, booking ID, type, message, read state, and creation time.
Use `PATCH /api/notifications/:id/read` to mark one of the caller's
notifications as read, or `PATCH /api/notifications/read-all` to mark all of
the caller's unread notifications as read. Both updates are idempotent, and a
notification belonging to another user is not exposed.

## Account deletion API

`DELETE /api/users/me` requires authentication and the account password as
`{ "password": "..." }`. It is refused while the user has a booking in progress
(`WAITING_FOR_CONFIRMATION` or `CONFIRMED`), as the customer or as the provider
of the booked service.

A successful request returns `200` with `{ "message": "account deleted" }` and
clears the login cookie. The account is soft-deleted: `deletedAt` is set and the
row stays, so bookings and reviews still resolve, but the personal details are
wiped (username becomes `deleted_<id>`, email is cleared so the address can
register again, the name becomes "Deleted User"). Provider details are cleared
except `avgRating`, the user's services are unpublished, their notifications
are removed, and a confirmation email goes to the old address. A failed email
is logged and does not fail the request.

Errors: `400` without a password, `401` without valid authentication or with a
wrong password, and `409` with `{ "error": "...", "bookings": [{ "id",
"bookingStatus", "appointmentDate", "service": { "title" } }] }` listing the
bookings in progress. Afterwards, tokens issued before the deletion return `401`
`"account has been deleted"`, login fails, and `GET /api/users/:id` returns `404`.

Email uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`
(see `.env.example`). Without `SMTP_HOST`, emails are logged to the console
instead of sent. Apply migrations with `npx prisma migrate deploy --config prisma7.config.ts`
to add `users.deletedAt`.

## Password reset API

`POST /api/auth/forgot-password` takes `{ "email": "..." }` and emails a reset
link (`<FRONTEND_URL>/reset-password?token=...`) to a registered, non-deleted
account. It answers `200` with the same message whether or not the email is
registered, so it can't be used to find out who has an account, and a failed
email is logged without failing the request. `400` for a missing or malformed
email. Requesting a new link voids the earlier ones.

`POST /api/auth/reset-password` takes `{ "token": "...", "password": "..." }`
(password at least 8 characters), sets the new password (bcrypt) and returns
`200` `{ "message": "password updated" }`. The link works once and expires 15
minutes after it was requested. Only a SHA-256 hash of the token is stored
(`password_reset_tokens`). An unknown, expired or used token, or one for a
deleted account, returns `400` `"this reset link is invalid or has expired"`
and changes nothing. Apply migrations with `npx prisma migrate deploy` to add
the table, then `npx prisma generate`.

### Enabling real emails (SMTP)

By default `SMTP_HOST` is empty, so no email is sent: the backend prints the
message, including the password reset link, in its console instead. That is
enough for development. To send real emails, point the backend at an SMTP
server. These steps use a Gmail account.

1. **Turn on 2-Step Verification** for the Gmail account at
   <https://myaccount.google.com/security>. Google only offers app passwords
   once it is on.
2. **Create an app password** at <https://myaccount.google.com/apppasswords>.
   Name it anything (e.g. `Togethr`) and copy the 16-letter code Google shows.
   It is shown only once. Your normal Gmail password does **not** work over SMTP.
3. **Edit `.env`** (copy it from `.env.example` first if you haven't). Remove the
   spaces from the app password and don't add quotes or braces:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your.address@gmail.com
   SMTP_PASS=abcdefghijklmnop
   MAIL_FROM="Togethr <your.address@gmail.com>"
   FRONTEND_URL=http://localhost:5173
   ```
   - `MAIL_FROM` should use the same address as `SMTP_USER`; Gmail replaces any
     other sender.
   - Put comments on their own line, not after a value.
   - `FRONTEND_URL` is the base of the link in the email
     (`<FRONTEND_URL>/reset-password?token=...`). Use the real site URL when deployed.
4. **Restart the backend.** nodemon does not watch `.env`, so type `rs` in its
   terminal or stop and run `npm run dev` again.
5. **Try it:** open `/forgot-password` on the frontend and enter the email of a
   registered account, which must be an inbox you can open (seed and test accounts
   use fake `@example.com` addresses). Check the spam folder if it doesn't arrive.

Never commit `.env` or the app password (`.env` is already in `.gitignore`).
Other SMTP providers work the same way with their own host, port, user and
password. For testing without a real inbox, <https://ethereal.email> gives free
throwaway SMTP credentials and a web inbox.

**Troubleshooting.** The API answers `200` even when sending fails, so it
doesn't reveal which emails are registered. Failures show only in the backend
console as `password reset email failed`:
- `535 ... Username and Password not accepted`: wrong `SMTP_USER`/`SMTP_PASS`, a
  normal password instead of an app password, spaces or a trailing comment in
  the value, or 2-Step Verification is off.
- No error and no email: the address isn't registered to any account (check for
  typos in the stored email), or the account is deleted.
- Email arrives but the link opens the wrong site: fix `FRONTEND_URL`.

## Test plan seed

`npm run seed:test` (`prisma/seed.test.js`) loads the fixed data the course
2110423 test plan refers to. Use it on a test database, not on the shared
demo data; it refuses to run with `NODE_ENV=production`.

1. Apply migrations to the test database and start the backend against it.
2. Register `somchai@gmail.com` as a customer and `somsri@gmail.com` as a
   provider through the API (`POST /api/auth/register`,
   `POST /api/auth/register/provider`). The seed looks them up by email and
   stops with an error if either is missing.
3. Run `npm run seed:test`. It creates customers nida (`nida@gmail.com` /
   `Nida@2026`) and kanya (`kanya@gmail.com` / `Kanya@2026`), an account
   deleted the same way as `DELETE /api/users/me` (`deleted.user@gmail.com`),
   an expired reset link T2 for nida, somsri's services SV-001 (published, with
   slots SL-01 to SL-03) and SV-002 (unpublished), and somchai's bookings
   BK-1001 to BK-1010 on SV-001. It prints a table of their ids and T2's raw
   token.

Run it again before each test round: it first removes what the previous run
created, including reviews, complaints and chat on the seeded bookings and
bookings made by nida and kanya, then recreates everything with the same ids
(only T2 changes). somchai and somsri themselves are kept. BK-1002 is created
25 hours old, so the expiry job marks it `EXPIRED` within a minute of the
backend running.

## 🚀 Getting Started

### Prerequisites
* Node.js (v18.x หรือสูงกว่า)
* Docker Desktop (ใช้รัน PostgreSQL ผ่าน Docker Compose — ต้องเปิดไว้ก่อนใช้งาน)
* npm หรือ yarn

### Installation & Running
1. Clone repository นี้ลงเครื่อง:
   ```bash
   git clone <BACKEND_REPOSITORY_URL>
   cd <REPOSITORY_NAME>
   ```

ดูขั้นตอนที่เหลือ (ติดตั้ง dependencies, ตั้งค่า `.env`, เปิด PostgreSQL, รัน migration, สตาร์ทเซิร์ฟเวอร์) ได้ที่ [SETUP.md](./SETUP.md)
