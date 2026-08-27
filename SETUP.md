# วิธีเปิดโปรเจกต์ (Setup Guide)

## สิ่งที่ต้องมีก่อน (Prerequisites)
- Node.js (v18 ขึ้นไป)
- Docker Desktop (ต้องเปิดไว้ก่อนใช้งาน)

## ขั้นตอน

1. ติดตั้ง dependencies
   ```
   npm install
   ```

2. สร้างไฟล์ `.env` จาก `.env.example`
   ```
   cp .env.example .env
   ```
   (ค่า default ใน `.env.example` ใช้ได้เลยสำหรับ dev บนเครื่อง ไม่ต้องแก้อะไร)

3. เปิด PostgreSQL ผ่าน Docker Compose
   ```
   docker compose up -d
   ```
   ตรวจสอบว่า container รันอยู่ด้วย `docker ps` (ควรเห็น `deawkoykid-postgres`)

4. รัน migration เพื่อสร้างตารางในฐานข้อมูล
   ```
   npx prisma migrate deploy
   ```
   คำสั่งนี้จะสร้างตาราง `users` (และตารางอื่น ๆ ที่จะเพิ่มในอนาคต) ตาม `prisma/schema.prisma`

5. (ตัวเลือก) เปิด Prisma Studio เพื่อดูข้อมูลในฐานข้อมูลผ่าน UI
   ```
   npx prisma studio
   ```

## หมายเหตุ
- ยังไม่มีไฟล์ `server.js` ในโปรเจกต์ ดังนั้น `npm run dev` (nodemon server.js) จะยังรันไม่ได้จนกว่าจะสร้างไฟล์นี้และเขียน Express server
- ถ้าแก้ schema ใน `prisma/schema.prisma` ระหว่าง dev ให้ใช้ `npx prisma migrate dev --name <ชื่อการเปลี่ยนแปลง>` แทน `migrate deploy` เพื่อสร้าง migration ใหม่
- เวลาปิดเครื่องหรือหยุดใช้งาน สามารถหยุด container ได้ด้วย `docker compose down` (ข้อมูลใน DB จะยังอยู่ เพราะเก็บใน Docker volume) ถ้าต้องการลบข้อมูลทั้งหมดด้วยให้ใช้ `docker compose down -v`
