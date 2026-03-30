# คู่มือ Deploy TRADE/DESK บน Cloudflare (ฟรี 100%)

## ภาพรวม
เมื่อ deploy เสร็จ จะได้ URL เช่น `https://trade-desk.pages.dev`
เปิดได้จากทุกที่ — มือถือ, PC, tablet — ราคาหุ้นดึงจาก Cloudflare Worker โดยตรง ไม่ผ่าน proxy

---

## ขั้นตอนที่ 1 — สมัคร GitHub (ถ้ายังไม่มี)

1. เปิด https://github.com
2. คลิก **Sign up**
3. กรอก email, password, username
4. ยืนยัน email
5. เสร็จแล้ว! GitHub ใช้เก็บ code ของเรา

---

## ขั้นตอนที่ 2 — สร้าง Repository บน GitHub

1. Login GitHub แล้วคลิก **+** มุมบนขวา → **New repository**
2. ตั้งชื่อ: `trade-desk`
3. เลือก **Public** (ต้องเป็น Public ถึงจะ deploy Cloudflare Pages ฟรีได้)
4. คลิก **Create repository**
5. GitHub จะแสดงหน้าว่างๆ พร้อม URL เช่น `https://github.com/USERNAME/trade-desk`

---

## ขั้นตอนที่ 3 — อัปโหลดไฟล์ขึ้น GitHub

วิธีที่ง่ายที่สุด — ผ่าน browser ไม่ต้องใช้ command line:

1. ในหน้า repository ที่เพิ่งสร้าง คลิก **uploading an existing file**
2. ลาก **ทุกไฟล์** จากโฟลเดอร์ `trade-desk` ที่ download มาวางในช่อง drop area
   - `public/index.html`
   - `functions/api/price.js`
   - `package.json`
   - `_redirects`
3. ที่ด้านล่าง ช่อง "Commit changes" ใส่ข้อความ: `Initial deploy`
4. คลิก **Commit changes**

> **หมายเหตุ:** ต้องรักษา folder structure ให้ถูก
> - `public/` → ใส่ `index.html`
> - `functions/api/` → ใส่ `price.js`
> - ไฟล์อื่น → ไว้ที่ root

**วิธีสร้าง folder ใน GitHub browser:**
- คลิก **Add file** → **Create new file**
- ในช่อง filename พิมพ์ `public/index.html` (พิมพ์ `/` จะสร้าง folder อัตโนมัติ)
- วาง content จากไฟล์ index.html
- Commit
- ทำซ้ำสำหรับ `functions/api/price.js`

---

## ขั้นตอนที่ 4 — สมัคร Cloudflare (ฟรี)

1. เปิด https://dash.cloudflare.com/sign-up
2. กรอก **Email** และ **Password**
3. คลิก **Create Account**
4. เช็ค email → คลิก verify link
5. เข้าสู่ Cloudflare Dashboard

---

## ขั้นตอนที่ 5 — Connect GitHub กับ Cloudflare Pages

1. ใน Cloudflare Dashboard ด้านซ้ายมือ คลิก **Workers & Pages**
2. คลิกปุ่มสีส้ม **Create application**
3. เลือก tab **Pages**
4. คลิก **Connect to Git**
5. คลิก **Connect GitHub**
   - Cloudflare จะขอ permission เข้า GitHub → คลิก **Authorize Cloudflare Pages**
6. เลือก repository `trade-desk` ที่เพิ่งสร้าง
7. คลิก **Begin setup**

---

## ขั้นตอนที่ 6 — ตั้งค่า Build

หน้า "Set up builds and deployments":

| ช่อง | ค่าที่ต้องใส่ |
|------|--------------|
| Project name | `trade-desk` (หรือชื่ออื่นตามชอบ) |
| Production branch | `main` |
| Framework preset | **None** |
| Build command | *(ปล่อยว่าง)* |
| Build output directory | `public` |

แล้วคลิก **Save and Deploy**

Cloudflare จะ:
1. ดึง code จาก GitHub
2. Deploy ไฟล์ใน `public/` ไปที่ edge network
3. Deploy `functions/api/price.js` เป็น Worker อัตโนมัติ
4. ใช้เวลาประมาณ 1-2 นาที

---

## ขั้นตอนที่ 7 — เสร็จแล้ว!

หลัง deploy สำเร็จ จะได้ URL เช่น:
```
https://trade-desk-abc123.pages.dev
```

คลิก URL นั้น → เปิด TRADE/DESK พอร์ตของคุณ!

**ทดสอบ Worker ทำงาน:**
เปิด URL นี้ในบราวเซอร์:
```
https://trade-desk-abc123.pages.dev/api/price?ticker=AMZN80
```
ถ้าเห็น JSON ที่มี `price` แสดงว่า Worker ทำงานถูกต้อง

---

## ขั้นตอนที่ 8 (Optional) — ใช้ Custom Domain

ถ้าอยากได้ URL สวยๆ เช่น `portfolio.yourdomain.com`:

1. ใน Cloudflare Pages project → **Custom domains**
2. คลิก **Set up a custom domain**
3. ใส่ domain ที่มีอยู่แล้ว
4. ทำตาม instructions เพิ่ม DNS record

---

## อัปเดต app ในอนาคต

ถ้าต้องการแก้ไข code:
1. แก้ไขไฟล์ใน GitHub (คลิก edit ตรงๆ ได้เลย)
2. Commit changes
3. Cloudflare จะ auto-deploy ภายใน 1-2 นาที อัตโนมัติ!

---

## สรุป Free Tier Limits

| บริการ | ฟรี |
|--------|-----|
| Cloudflare Pages | ไม่จำกัด bandwidth, 500 deploy/เดือน |
| Cloudflare Workers | 100,000 requests/วัน |
| Custom domain | ฟรี (ถ้า domain อยู่ใน Cloudflare) |

**สำหรับ portfolio ส่วนตัว ฟรี 100% ตลอดชีพ**
