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

## In-app notifications API

Authenticated users can list their notifications with `GET /api/notifications`.
The response is `{ "notifications": [...] }`, ordered newest first. Each item
includes its ID, booking ID, type, message, read state, and creation time.
Use `PATCH /api/notifications/:id/read` to mark one of the caller's
notifications as read, or `PATCH /api/notifications/read-all` to mark all of
the caller's unread notifications as read. Both updates are idempotent, and a
notification belonging to another user is not exposed.

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
