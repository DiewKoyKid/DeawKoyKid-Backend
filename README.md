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