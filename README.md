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
