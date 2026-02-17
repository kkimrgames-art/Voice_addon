# خادم EnviroVoice (EnviroVoice Server)
خادم متطور لنظام المحادثة الصوتية في Minecraft Bedrock، يدعم فلاتر الصوت المحيطية والاتصال في الوقت الفعلي.

## المميزات (Features)
- **دعم Render.com**: جاهز للنشر الفوري مع إعدادات البروكسي والمنفذ الديناميكي.
- **إدارة الذاكرة**: محسن للعمل باستهلاك ذاكرة منخفض (أقل من 200MB لـ 32 لاعب).
- **الأمان**: يتضمن نظام تحديد السرعة (Rate Limiting) وحماية من الرسائل الضخمة.
- **متابعة الحالة**: يوفر نقطة وصول `/health` لمراقبة الأداء والاتصالات.

## التشغيل السريع (Quick Start)

### المتطلبات
- Node.js v14 أو أحدث.
- إمكانية الوصول إلى الإنترنت (لتحميل الحزم).

### التثبيت
```bash
npm install
```

### التشغيل
**للموقع الفعلي (Production):**
```bash
npm start
```
*سيقوم هذا الأمر بتشغيل `server-production.js` المزود بكافة التحسينات.*

**للتطوير (Development):**
```bash
npm run dev
```

## الإعدادات (Configuration)
يمكن التحكم في السيرفر عبر متغيرات البيئة (Environment Variables):
- `PORT`: المنفذ الذي سيعمل عليه السيرفر (افتراضي: 3000).
- `MAX_CONNECTIONS`: أقصى عدد من اللاعبين المتصلين (افتراضي: 200).

## نقاط الوصول (Endpoints)
- **WebSocket**: `ws://your-app.render.com` (للمحادثة الصوتية).
- **HTTP POST**: `/minecraft-data` (لاستقبال بيانات اللاعبين من المود).
- **HTTP GET**: `/health` (لفحص حالة السيرفر).

---
## English Summary
EnviroVoice Server is an optimized Node.js WebSocket server for Minecraft Bedrock voice chat. It features environment-based voice filtering, low memory footprint, and is fully compatible with Render.com hosting.

### Deployment on Render:
1. Connect your repository.
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Plan: Starter (512MB RAM is more than enough).
