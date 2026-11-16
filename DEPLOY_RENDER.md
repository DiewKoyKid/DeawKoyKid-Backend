# Deploy ผ่าน GitHub → Render

ใช้ Dockerfile เดิม ให้ Render build และเก็บ image ให้ ไม่ต้อง push image ไป registry เอง
คู่มือนี้ยังไม่ได้สร้าง service, push Git หรือเปลี่ยนฐานข้อมูลให้

## ค่าที่เตรียมไว้สำหรับ Vercel + Render

มี render.yaml สำหรับสร้างผ่าน Render → New → Blueprint → เชื่อม GitHub repo → เลือก main
ไฟล์นี้กำหนด branch: main และ autoDeployTrigger: commit แล้ว โดยเลือก paid plan 0.5c-512mb
ตรวจค่าใช้จ่ายที่ Render แสดงก่อนกดสร้าง service ไม่ต้องใช้ GitHub Actions หรือ push image
ถ้าสร้าง Web Service เองตามหัวข้อ 3 ให้กรอกค่าด้านล่างเอง เพราะ Render ไม่อ่าน Blueprint อัตโนมัติใน flow นั้น

สำหรับ frontend vercel.app และ backend onrender.com ให้ใช้:

```dotenv
AUTH_COOKIE_SAME_SITE=none
AUTH_COOKIE_PARTITIONED=true
```

โค้ดใช้ HttpOnly; Secure; SameSite=None; Partitioned (CHIPS) ใน production
cookie ถูกแยกตาม top-level site จึงต้อง login ผ่าน frontend จริง ไม่ใช่เปิด backend แยกแล้วคาดหวัง session เดียวกัน
login และ logout ใช้ options เดียวกัน รวม partitioned และ path
frontend ตรวจ GET /api/users/me หลัง login ก่อนเปลี่ยนหน้า เพื่อไม่แสดงว่าล็อกอินสำเร็จหาก browser ไม่ส่ง cookie
CHIPS ต้องใช้ browser ที่รองรับและ HTTPS; ไม่ได้ข้ามการบล็อก cookies ทั้งหมด
ยังต้องทดสอบ Chrome จริงโดยเปิด Block third-party cookies หลัง deploy รวม REST, refresh, Socket.IO และ logout
Vercel preview URL อื่นต้องตั้ง CORS ให้ตรงและ login ใหม่ อย่าใช้ wildcard origin กับ credentials
เอกสาร CHIPS: https://privacysandbox.google.com/cookies/chips

## 1. เตรียม GitHub และฐานข้อมูล

- Push โค้ดที่ต้องการ deploy ไป branch ที่เลือกบน GitHub รวม Dockerfile, package-lock.json และ prisma/migrations
- ไม่ commit .env, credentials หรือไฟล์อัปโหลด และตรวจ git status ก่อนเลือกไฟล์ commit
- ใช้ PostgreSQL ที่ Render เชื่อมถึงได้ ไม่ใช้ localhost ของเครื่องผู้พัฒนา
- คงฐานข้อมูลเดิมได้ ไม่จำเป็นต้องสร้างใหม่เพียงเพราะย้าย hosting

## 2. Apply migrations ก่อนเปิดใช้งาน

Dockerfile ขั้น runtime ตัด devDependencies รวม Prisma CLI ออก จึงไม่ตั้ง Pre-Deploy Command เป็น npx prisma บน image นี้
ให้รันจาก checkout ของ commit ที่จะ deploy บนเครื่องที่ติดตั้ง dependencies แล้ว:

```powershell
npm ci
npm run db:migrate
```

ก่อนรัน ให้ตั้ง DATABASE_URL และ DIRECT_URL ใน .env ที่ไม่ถูก commit ให้ชี้ฐานข้อมูลเป้าหมายจริง
prisma.config.ts ใช้ DIRECT_URL ก่อน DATABASE_URL จึงต้องตรวจทั้งสองค่า ไม่ปล่อย DIRECT_URL ชี้ localhost เดิม
คำสั่ง migrate จะเปลี่ยนฐานข้อมูล: สำรองข้อมูลเดิมและตรวจ pending migrations ก่อนรัน
ไม่ใช้ migrate reset หรือ seed:test บน production
เมื่อมี migration ใหม่ในอนาคต ให้ทำขั้นตอนนี้ก่อน deploy และออกแบบให้เข้ากันได้กับ service รุ่นที่ยังรันอยู่

## 3. สร้าง Render Web Service

1. เปิด https://dashboard.render.com → New → Web Service
2. เชื่อมบัญชี GitHub และเลือก repository backend ผ่าน Git provider (ไม่ใช่ public repository URL)
3. เลือก branch ที่ต้องการ deploy
4. ตั้งค่าตามตาราง:

| ช่อง | ค่า |
|---|---|
| Language | Docker |
| Root Directory | เว้นว่าง หาก Dockerfile อยู่ราก repo |
| Dockerfile Path | ./Dockerfile |
| Docker Build Context | . |
| Docker Command | เว้นว่าง ใช้ CMD ของ Dockerfile |
| Pre-Deploy Command | เว้นว่าง สำหรับ image ปัจจุบัน |
| Health Check Path | /health |
| Auto-Deploy | On Commit |

ไม่ต้องกรอก Build Command หรือ Start Command แบบ Node runtime
เลือก instance แบบเสียเงินหากต้องใช้ SMTP และให้ booking jobs ทำงานต่อเนื่อง
Free instance พักเมื่อไม่มี traffic 15 นาที และบล็อก SMTP ports 25, 465, 587

## 4. Environment variables

กรอกค่าจริงใน Render Environment ไม่ใส่เครื่องหมาย < > และไม่ต้องครอบค่าด้วย quotes:

```dotenv
NODE_ENV=production
TZ=Asia/Bangkok
DATABASE_URL=<production PostgreSQL connection string>
JWT_SECRET=<random secret>
JWT_EXPIRES_IN=30m
AUTH_COOKIE_SAME_SITE=none
AUTH_COOKIE_PARTITIONED=true
CORS_ORIGIN=https://<frontend hostname>
FRONTEND_URL=https://<frontend hostname>
SMTP_HOST=<SMTP server>
SMTP_PORT=587
SMTP_USER=<SMTP username>
SMTP_PASS=<SMTP password>
MAIL_FROM=<sender email>
DB_POOL_MAX=5
BOOKING_EXPIRY_INLINE=true
BOOKING_PROGRESS_INLINE=true
```

สร้าง JWT_SECRET ใหม่ได้ด้วย `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`
ถ้าต้องการให้ session เดิมยังใช้ได้ ให้ใช้ secret เดิมอย่างปลอดภัยแทนการเปลี่ยน
CORS_ORIGIN ต้องเป็น origin เท่านั้น ไม่มี path หรือ slash ท้าย
ไม่ต้องกำหนด PORT เอง เพราะ server.js อ่านค่าจาก hosting
inline jobs ในคู่มือนี้สำหรับ backend instance เดียว หากขยายหลาย instance ให้แยก scheduler ก่อน

Storage: ตั้งค่า driver และ credentials ของระบบเก็บไฟล์เดิมใน Render ด้วย
อย่าใช้ local storage สำหรับไฟล์ที่ต้องเก็บถาวรโดยไม่มี persistent disk: filesystem ของ service ไม่ถาวร
การย้าย hosting ไม่ย้ายไฟล์ที่เคยอัปโหลดบน server เดิมให้ ต้องย้ายข้อมูลนั้นแยกต่างหาก

## 5. Deploy และเชื่อม frontend

กด Deploy แล้วดู Logs จนพบ Server listening on port ...
ทดสอบ https://<service>.onrender.com/health และ /ready ต้องได้ HTTP 200 ทั้งคู่
/ready ตรวจฐานข้อมูลด้วย ส่วน /health ตรวจว่า process ตอบคำขอได้

ตั้ง environment ของ frontend แล้ว build/deploy frontend ใหม่:

```dotenv
VITE_API_BASE_URL=https://<service>.onrender.com/api
VITE_USE_MOCKS=false
```

ทดสอบ login, refresh, API ที่ต้องล็อกอิน, chat, upload, reset password และ logout
ทดสอบอัปโหลดอีกครั้งหลัง redeploy เพื่อยืนยันว่าไฟล์ยังอยู่

## 6. Cookie และ custom domain

การเชื่อม GitHub ไม่ได้แก้ third-party cookie โดยตัวมันเอง
แนะนำ app.yourdomain.com สำหรับ frontend และ api.yourdomain.com สำหรับ Render โดยใช้ HTTPS ทั้งคู่
เพิ่ม custom domain ใน Render Settings แล้วตั้ง DNS ตามค่าที่ Render แสดง
เปลี่ยน CORS_ORIGIN, FRONTEND_URL และ VITE_API_BASE_URL ให้ใช้ custom domains
หากเปลี่ยนมาใช้ same-site ให้ตั้ง AUTH_COOKIE_SAME_SITE=lax และ AUTH_COOKIE_PARTITIONED=false
พร้อมแก้ค่าใน render.yaml ด้วย เพื่อไม่ให้ Blueprint sync กลับเป็นค่าเดิม
ห้ามเปลี่ยนเป็น Lax ขณะที่ยังเรียก API ข้าม site

หากใช้ frontend *.vercel.app กับ backend *.onrender.com ให้ใช้ partitioned cookie ตามค่าที่เตรียมไว้ด้านบน
same-site domain หรือ proxy เป็นทางเลือกหาก browser เป้าหมายไม่รองรับ CHIPS

## 7. อัปเดตครั้งต่อไป

Push หรือ merge ไป branch ที่เชื่อมไว้ → Render build จาก Dockerfile → deploy อัตโนมัติ
ไม่ต้องตั้ง GitHub Actions สำหรับการ deploy พื้นฐานนี้
ถ้า repo มี CI แล้วจึงเลือก After CI Checks Pass; อย่าเลือกเมื่อยังไม่มี checks
อย่าปิด server เก่าจนตรวจ endpoint, storage, email, chat และ DNS ของ service ใหม่ครบ
หลังย้ายสำเร็จ ให้ปิด scheduler เก่าที่ทำงานซ้ำกับ inline jobs ของ service ใหม่

## เอกสารอ้างอิง

- https://render.com/docs/docker
- https://render.com/docs/deploys
- https://render.com/docs/free
- https://render.com/docs/custom-domains
