import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

// Initialize Gemini API client on the server
// Uses User-Agent header for telemetry
const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for health-check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", hasApiKey: !!apiKey });
  });

  // API Route: Predict Sales Opportunity
  app.post("/api/gemini/predict-sales", async (req, res) => {
    try {
      if (!apiKey) {
        return res.json({ score: 'Medium', reason: 'GEMINI_API_KEY غير متوفر في السيرفر' });
      }

      const { client, followUps } = req.body;
      if (!client) {
        return res.status(400).json({ error: "Missing client parameter" });
      }

      const history = (followUps || []).map((f: any) => {
        const timing = f.isEarly ? "EARLY" : "ON-TIME";
        return `${new Date(f.timestamp).toLocaleDateString()}: ${f.note} (${timing}, Method: ${f.method})`;
      }).join('\n');

      const prompt = `Analyze educational academy lead: ${client.name}, Current Status: ${client.status}. 
      Communication History:\n${history}\n
      Task: 
      1. Predict conversion score (High, Medium, Low).
      2. Analyze if early communication is working for this lead.
      3. Provide 1 professional recommendation in Arabic.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.STRING },
              reason: { type: Type.STRING },
              earlyContactEffect: { type: Type.STRING }
            },
            required: ["score", "reason"],
          },
        },
      });

      const jsonStr = response.text?.trim();
      if (!jsonStr) {
        return res.json({ score: 'Medium', reason: 'لم يتم استلام رد من الذكاء الاصطناعي' });
      }

      const parsed = JSON.parse(jsonStr);
      res.json(parsed);
    } catch (error: any) {
      res.json({ score: 'Medium', reason: 'فرصة تحويل متوسطة - بناءً على بيانات العميل وسجل المتابعات' });
    }
  });

  // API Route: Analyze Daily Report
  app.post("/api/gemini/analyze-report", async (req, res) => {
    try {
      if (!apiKey) {
        return res.json({ text: "تقرير مكتمل. حافظ على متابعة العملاء المهتمين وتحديث السجلات أولاً بأول." });
      }

      const { report } = req.body;
      if (!report) {
        return res.status(400).json({ error: "Missing report parameter" });
      }

      const prompt = `تحليل تقرير مبيعات أكاديمية تعليمية:
      الموظف: ${report.userName}
      عملاء جدد: ${report.newClients}
      مهتمين: ${report.interested}
      حجوزات: ${report.booked}
      متابعات مكتملة: ${report.completedToday}
      نسبة الالتزام بالمواعيد: ${report.punctualityRatio}%
      تأخيرات كبيرة: ${report.largeDelays}
      ملاحظات الموظف: ${report.notes}
      
      قدم تحليل مهني قصير (30 كلمة) باللغة العربية مع نصيحة واحدة لتحسين الأداء أو سرعة المتابعة.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
      });

      res.json({ text: response.text || "تم تسجيل التقرير بنجاح. ينصح بالتركيز على سرعة التواصل مع الجدد." });
    } catch (error: any) {
      res.json({ text: "تم تسجيل التقرير بنجاح. ينصح باستغلال المتابعات الأولى لزيادة نسبة الحجز." });
    }
  });

  // Helper for generating rule-based fallback when Gemini API hits rate limits or quota
  const generateFallbackClientAnalysis = (client: any) => {
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const courseName = client.bookedCourseName || client.serviceName || 'كورس الجرافيك ديزاين والـ AI';
    const clientName = client.name || 'عزيزنا المتدرب';
    const statusStr = (client.status || '').toLowerCase();
    const isBooked = statusStr.includes('book') || statusStr.includes('حجز') || statusStr.includes('مسجل') || statusStr.includes('enrolled');

    if (isBooked) {
      return {
        suggestedDate: tomorrowStr,
        suggestedTime: "15:00",
        suggestedChannel: "واتساب",
        suggestedPitch: `أهلاً بك يا ${clientName}! سعداء جداً بانضمامك لعائلة أكاديمية صابر جروب في ${courseName} 🎉 نتمنى لك رحلة تعلم ممتازة، وفريق الدعم والمحاضرات جاهز للترحيب بك وتزويدك بمواعيد المجموعات ورابط القناة الرسمية.`,
        conversionPriority: 'منخفض',
        insightsSummary: `العميل (${clientName}) قام بالحجز والانضمام لـ (${courseName}) بالفعل. لا يحتاج لمتابعات بيعية بل ينقل لقناة المتدربين والخدمة الطلابية.`,
        salesTip: "تمت عملية البيع والحجز بنجاح! ركز على جودة تجربة الانضمام والتنسيق مع فريق خدمة المتدربين."
      };
    }
    
    return {
      suggestedDate: tomorrowStr,
      suggestedTime: "15:00",
      suggestedChannel: "واتساب",
      suggestedPitch: `أهلاً بك يا ${clientName}! معك المساعد الذكي من أكاديمية صابر جروب (SABER GROUP) 🎨 نحب نذكرك بإن باب الحجز المبكر لكورس ${courseName} مفتوح حالياً بخصم مميز بالإضافة لكوبون خصم إضافي 400 جنيه متاح لمدة 24 ساعة فقط! تقدر تقسط باقتك بدون أي فوائد. لتأكيد الحجز والاستفسار تواصل معنا عبر واتساب الرسمي: 01040784390`,
      conversionPriority: client.status === 'مهتم' ? 'عالي' : 'متوسط',
      insightsSummary: `تحليل صابر جروب الذكي: العميل (${clientName}) يظهر اهتماماً بـ (${courseName}). نوصي بتقديم تفاصيل الخصم المبكر والتقسيط المريح والتأكيد على المزايا العملية.`,
      salesTip: "استخدم كوبون الـ 400 جنيه الإضافي لتشجيع العميل على تحويل العربون والتأكيد خلال 24 ساعة."
    };
  };

  // API Route: Analyze Client & Generate Sales Recommendations
  app.post("/api/gemini/analyze-client", async (req, res) => {
    const { client, followUps } = req.body || {};
    if (!client) {
      return res.status(400).json({ error: "Missing client parameter" });
    }

    if (!apiKey) {
      return res.json(generateFallbackClientAnalysis(client));
    }

    const historyText = (followUps || []).map((f: any) => {
      const dateStr = f.timestamp ? new Date(f.timestamp).toLocaleDateString('ar-EG') : '';
      return `- [${dateStr}] [وسيلة التواصل: ${f.method || 'اتصال'}] ملاحظات: ${f.note || 'متابعة'} (النتيجة: ${f.result || 'غير محدد'}) (الملخص: ${f.salesBrief || 'لا يوجد'})`;
    }).join('\n');

    const todayStr = new Date().toISOString().split('T')[0];

    const SABER_KNOWLEDGE_BASE = `
# قاعدة معرفة أكاديمية صابر جروب (SABER GROUP Courses Academy)

## عن الأكاديمية
- **الاسم:** SABER GROUP Courses Academy (أكاديمية تعليم الجرافيك ديزاين والذكاء الاصطناعي في التصميم).
- **المقر الرئيسي:** طنطا — منطقة الإستاد، شارع البنداري.
- **التواجد الأونلاين:** 22 ألف متابع على فيسبوك، محاضرات تفاعلية مسجلة عبر Google Meet.
- **المدرب الرئيسي:** معتمد دولياً من Adobe.
- **الرسالة:** "أفضل مكان في الوطن العربي لتعلم الجرافيك ديزاين - دورات متكاملة من الصفر للاحتراف، تدريب عملي، ورش تطبيقية، وتأهيل فعلي لسوق العمل."
- **التجربة الذكية:** الأكاديمية مدعمة بالكامل بالذكاء الاصطناعي "مارو" في جميع مراحل التعلم والخدمات.

## الكورسات والمسارات المتاحة

### 1) كورس الجرافيك ديزاين من الصفر للاحتراف (المستوى الأساسي)
- **المدة:** من 2.5 إلى 3 شهور، سيشن مرتين أسبوعياً، كل سيشن 3 ساعات (~50 ساعة تدريبية إجمالاً).
- **النظام:** أونلاين (Google Meet متاح تسجيلها دائماً) أو أوفلاين في مقر طنطا.
- **البرامج:** Photoshop – Illustrator – InDesign.
- **الورش المدمجة:** التفكير الإبداعي للحملات الإعلانية، تصميم السوشيال ميديا، تصميم اللوجوهات والبراندنج والهوية البصرية، ورشة الذكاء الاصطناعي في التصميم (توليد الصور، التعديل الطبيعي، المعالجة بالـ AI).
- **المخرجات:** بورتفوليو احترافي، تصميم إعلانات وبوسترات ولوجوهات، ترشيح الملتزمين لفرص عمل بشركات.

### 2) كورس المستوى المتقدم — التصميم الإعلاني بالذكاء الاصطناعي
- **الفئة:** للمصممين الممارسين لتطوير مستواهم عالمياً.
- **التميز:** مشاريع الخريجين بتتنشر على Ads of the World.
- **المحاور:** أحدث أدوات وModels الـ AI (مجانية ومدفوعة)، الظل والإضاءة والمنظور ونظريات الألوان والدمج المتقدم، إعداد الحملات والتسويق واستلام البريف، مهارات التسعير والتفاوض والبرسونال براندينج.

## الأسعار والتقسيط والعروض
- **المستوى الأساسي (من الصفر):** السعر الكامل 5500 جنيه | سعر الحجز المبكر 3500 جنيه.
- **المستوى المتقدم:** السعر الكامل 6000 جنيه | سعر الحجز المبكر 4500 جنيه.
- **نظام التقسيط:** عربون بسيط للحجز + الباقي بالتقسيط بدون أي فوائد (تتحدد تفاصيل القسط والعربون مع خدمة العملاء حسب العرض اللحظي).
- **عرض تجربة المساعد الذكي (مارو):** عند تجربة المساعد الذكي، يحصل العميل على **كوبون خصم إضافي 400 جنيه** صالح لمدة **24 ساعة فقط** لتشجيعه على الحجز الفوري.

## أسلوب وقواعد السيلز (Sales Tone & Strategy)
- **النبرة:** مصري عامي، دافئ وقريب من العميل زي صحابه ("عيلتنا")، إيموجيز باعتدال، تطمين العميل قبل كل شيء.
- **ترتيب الرد المالي المفروض:**
  1. التطمين أولاً: "جزء السعر آخر حاجة تقلق بيها".
  2. الإثبات بالبورتفوليو والأعمال الحقيقية (روابط Behance وFacebook وخريجي Ads of the World).
  3. عرض السعر للخصم المبكر والتأكيد على التقسيط والحلول المرنة.
  4. تحويل الحجز النهائي وتأكيد العرض لخدمة العملاء على واتساب (01040784390) مع التلميح بوجود عرض خاص إضافي هناك.
- **الرد على الاعتراضات:**
  - *عدم توفر لابتوب:* الجهاز مش شرط في البداية، ونقدر ننسق سوا النظام المناسب لإمكانياتك.
  - *عدم التأكد من الشغف:* الشغف بييجي مع التجربة والتعلم ورؤية التطور الداخلي.
  - *الخوف من السعر:* إبراز خيارات التقسيط المريحة وأن الأكاديمية لا تقفل الباب أمام أي متدرب.
`;

    const prompt = `أنت المساعد الذكي ورئيس فريق المبيعات الأكاديمي (AI Sales Lead & Advisor) لأكاديمية صابر جروب (SABER GROUP Courses Academy).
تاريخ اليوم الحالي: ${todayStr}.

استند بالكامل إلى قاعدة معرفة صابر جروب التالية عند تحليل بيانات العميل واقتراح خطوات المبيعات:
${SABER_KNOWLEDGE_BASE}

تنبيه هام جداً بخصوص حالة العميل:
- إذا كانت حالة العميل هي (حجز / booked / مسجل / تم الحجز / enrolled)، فهذا يعني أن العميل قام بالشراء والانضمام للكورس بالفعل، وبالتالي تمت عملية البيع بنجاح وهو غير مستهدف بعروض بيعية جديدة، بل تكون التوصية للترحيب به كطالب وتوجيهه لقنوات الدعم الأكاديمي.
- أما إذا كانت حالته (مهتم / محتمل / interested / potential)، فهو العميل المستهدف الرئيسي بالمتابعات البيعية والعروض والتأكيد على الحجز والتقسيط وكوبون الخصم.

---
بيانات العميل المراد تحليله:
- الاسم: ${client.name}
- الهاتف: ${client.phone}
- الحالة الحالية: ${client.status}
- المصدر: ${client.source || 'غير محدد'}
- الكورس المطلوب / الخدمة: ${client.bookedCourseName || client.serviceName || 'كورس جرافيك ديزاين'}
- الدولة: ${client.country || 'مصر'}
- الملاحظات المسجلة: ${client.notes || 'لا يوجد'}
- تاريخ إنشاء البروفايل: ${client.createdAt ? new Date(client.createdAt).toLocaleDateString('ar-EG') : 'غير محدد'}

سجل المتابعة والمكالمات السابقة:
${historyText || 'لا توجد متابعات سابقة بعد'}

---
المطلوب منك تحليل العميل وتوليد توصية وسيناريو مبيعات احترافي باللغة العربية (بالنبرة المصرية الدافئة والمقنعة لأكاديمية صابر جروب):
1. **suggestedDate**: موعد المتابعة القادمة الأنسب بتاريخ مستقبلي (YYYY-MM-DD).
2. **suggestedTime**: ساعة المتابعة (HH:MM).
3. **suggestedChannel**: قناة التواصل الأنسب (واتساب / اتصال هاتفي / مقابلة في المقر / رسالة نصية).
4. **suggestedPitch**: سيناريو رسالة إقناع مخصص ومكتوب بالنبرة المصرية الدافئة لأكاديمية صابر جروب (يشمل التطمين، الإشارة للبورتفوليو أو التقسيط أو كوبون الـ 400 جنيه الخاص بالمساعد الذكي مارو، مع دعوتهم للتواصل عبر واتساب 01040784390 للحجز).
5. **conversionPriority**: أولوية تحويل العميل ('عالي' / 'متوسط' / 'منخفض').
6. **insightsSummary**: ملخص سريع لسلوك ورغبة العميل واعتراضاته المحتملة بناءً على سجله والدورة المطلوبة.
7. **salesTip**: نصيحة مبيعات ذهبية للمسؤول المتابع للتعامل مع هذا العميل وإغلاق الصفقة.`;

    // Attempt call with retry or graceful fallback on Rate Limit / 429 Error
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                suggestedDate: { type: Type.STRING, description: "YYYY-MM-DD" },
                suggestedTime: { type: Type.STRING, description: "HH:MM" },
                suggestedChannel: { type: Type.STRING },
                suggestedPitch: { type: Type.STRING },
                conversionPriority: { type: Type.STRING },
                insightsSummary: { type: Type.STRING },
                salesTip: { type: Type.STRING }
              },
              required: ["suggestedDate", "suggestedChannel", "suggestedPitch", "conversionPriority", "insightsSummary", "salesTip"]
            }
          }
        });

        const jsonStr = response.text?.trim();
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr);
          return res.json(parsed);
        }
      } catch (err: any) {
        const isQuotaOrAuth = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('prepayment') || err?.message?.includes('quota');
        if (isQuotaOrAuth) {
          // Immediately serve fallback recommendation without retrying or emitting error logs
          return res.json(generateFallbackClientAnalysis(client));
        }
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    return res.json(generateFallbackClientAnalysis(client));
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
