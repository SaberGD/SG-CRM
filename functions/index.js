const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const { GoogleGenAI, Type } = require("@google/genai");

function hashForMeta(value) {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Reports Lead/Purchase events straight from the CRM to Meta's Conversions API,
 * so Meta Ads can optimize on real bookings/payments instead of only ad clicks.
 * Called from SG-CRM's metaService.ts.
 */
exports.metaCapiEvent = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const metaPixelId = process.env.META_PIXEL_ID || "";
  const metaAccessToken = process.env.META_ACCESS_TOKEN || "";
  if (!metaPixelId || !metaAccessToken) {
    return res.status(403).json({ error: "Meta CAPI is not configured (META_PIXEL_ID / META_ACCESS_TOKEN missing)" });
  }

  const { eventName, phone, value, currency, eventId, contentName, contentCategory, sourceUrl, testEventCode } = req.body || {};
  if (!eventName || !phone) {
    return res.status(400).json({ error: "Missing eventName or phone" });
  }

  const normalizedPhone = String(phone).replace(/\D/g, "");
  if (!normalizedPhone) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

  const eventData = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: "system_generated",
    user_data: { ph: [hashForMeta(normalizedPhone)] },
  };
  if (eventId) eventData.event_id = String(eventId);
  if (sourceUrl) eventData.event_source_url = sourceUrl;
  if (value !== undefined || currency || contentName || contentCategory) {
    eventData.custom_data = {
      ...(value !== undefined ? { value } : {}),
      currency: currency || "EGP",
      ...(contentName ? { content_name: contentName } : {}),
      ...(contentCategory ? { content_category: contentCategory } : {}),
    };
  }

  const payload = { data: [eventData] };
  if (testEventCode) payload.test_event_code = String(testEventCode);

  try {
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${metaPixelId}/events?access_token=${encodeURIComponent(metaAccessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const metaJson = await metaRes.json();
    if (!metaRes.ok) {
      console.error("Meta CAPI rejected event:", metaJson);
      return res.status(502).json({ error: "Meta API rejected the event", details: metaJson });
    }
    return res.json({ success: true, metaResponse: metaJson });
  } catch (error) {
    console.error("Meta CAPI send error:", error);
    return res.status(500).json({ error: error?.message || "Unknown error sending Meta event" });
  }
});

// ---------------------------------------------------------------------------
// Gemini AI bridge functions.
// Production (Hostinger static hosting) has no Node/Express server, so the
// three /api/gemini/* routes that exist only inside server.ts (used by AI
// Studio's own preview) never run in production. These Cloud Functions mirror
// those routes exactly so geminiService.ts can call them from the live site.
// ---------------------------------------------------------------------------

// Vertex AI mode via Application Default Credentials — bills to this project's
// Cloud Billing account instead of a free-tier API key.
const ai = new GoogleGenAI({
  vertexai: true,
  project: "sg-crm-e3a38",
  location: "global",
});

/**
 * Predicts a lead's conversion likelihood from their status + follow-up history.
 * Mirrors server.ts's POST /api/gemini/predict-sales route.
 */
exports.geminiPredictSales = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { client, followUps } = req.body || {};
    if (!client) {
      return res.status(400).json({ error: "Missing client parameter" });
    }

    const history = (followUps || []).map((f) => {
      const timing = f.isEarly ? "EARLY" : "ON-TIME";
      return `${new Date(f.timestamp).toLocaleDateString()}: ${f.note} (${timing}, Method: ${f.method})`;
    }).join("\n");

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
            earlyContactEffect: { type: Type.STRING },
          },
          required: ["score", "reason"],
        },
      },
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) {
      return res.json({ score: "Medium", reason: "لم يتم استلام رد من الذكاء الاصطناعي" });
    }
    return res.json(JSON.parse(jsonStr));
  } catch (error) {
    console.error("geminiPredictSales error:", error);
    return res.json({ score: "Medium", reason: "فرصة تحويل متوسطة - بناءً على بيانات العميل وسجل المتابعات" });
  }
});

/**
 * Generates a short Arabic performance analysis for a daily sales report.
 * Mirrors server.ts's POST /api/gemini/analyze-report route.
 */
exports.geminiAnalyzeReport = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { report } = req.body || {};
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

    return res.json({ text: response.text || "تم تسجيل التقرير بنجاح. ينصح بالتركيز على سرعة التواصل مع الجدد." });
  } catch (error) {
    console.error("geminiAnalyzeReport error:", error);
    return res.json({ text: "تم تسجيل التقرير بنجاح. ينصح باستغلال المتابعات الأولى لزيادة نسبة الحجز." });
  }
});

function generateFallbackClientAnalysis(client) {
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const courseName = client.bookedCourseName || client.serviceName || "كورس الجرافيك ديزاين والـ AI";
  const clientName = client.name || "عزيزنا المتدرب";
  const statusStr = (client.status || "").toLowerCase();
  const isBooked = statusStr.includes("book") || statusStr.includes("حجز") || statusStr.includes("مسجل") || statusStr.includes("enrolled");

  if (isBooked) {
    return {
      suggestedDate: tomorrowStr,
      suggestedTime: "15:00",
      suggestedChannel: "واتساب",
      suggestedPitch: `أهلاً بك يا ${clientName}! سعداء جداً بانضمامك لعائلة أكاديمية صابر جروب في ${courseName} 🎉 نتمنى لك رحلة تعلم ممتازة، وفريق الدعم والمحاضرات جاهز للترحيب بك وتزويدك بمواعيد المجموعات ورابط القناة الرسمية.`,
      conversionPriority: "منخفض",
      insightsSummary: `العميل (${clientName}) قام بالحجز والانضمام لـ (${courseName}) بالفعل. لا يحتاج لمتابعات بيعية بل ينقل لقناة المتدربين والخدمة الطلابية.`,
      salesTip: "تمت عملية البيع والحجز بنجاح! ركز على جودة تجربة الانضمام والتنسيق مع فريق خدمة المتدربين.",
    };
  }

  return {
    suggestedDate: tomorrowStr,
    suggestedTime: "15:00",
    suggestedChannel: "واتساب",
    suggestedPitch: `أهلاً بك يا ${clientName}! معك المساعد الذكي من أكاديمية صابر جروب (SABER GROUP) 🎨 نحب نذكرك بإن باب الحجز المبكر لكورس ${courseName} مفتوح حالياً بخصم مميز بالإضافة لكوبون خصم إضافي 400 جنيه متاح لمدة 24 ساعة فقط! تقدر تقسط باقتك بدون أي فوائد. لتأكيد الحجز والاستفسار تواصل معنا عبر واتساب الرسمي: 01040784390`,
    conversionPriority: client.status === "مهتم" ? "عالي" : "متوسط",
    insightsSummary: `تحليل صابر جروب الذكي: العميل (${clientName}) يظهر اهتماماً بـ (${courseName}). نوصي بتقديم تفاصيل الخصم المبكر والتقسيط المريح والتأكيد على المزايا العملية.`,
    salesTip: "استخدم كوبون الـ 400 جنيه الإضافي لتشجيع العميل على تحويل العربون والتأكيد خلال 24 ساعة.",
  };
}

/**
 * The "AI Sales Assistant" feature (مساعد ذكي) - analyzes a client and drafts a
 * personalized Arabic sales pitch. Mirrors server.ts's POST /api/gemini/analyze-client
 * route, including its embedded SABER GROUP knowledge base and rule-based fallback.
 */
exports.geminiAnalyzeClient = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { client, followUps } = req.body || {};
  if (!client) {
    return res.status(400).json({ error: "Missing client parameter" });
  }

  const historyText = (followUps || []).map((f) => {
    const dateStr = f.timestamp ? new Date(f.timestamp).toLocaleDateString("ar-EG") : "";
    return `- [${dateStr}] [وسيلة التواصل: ${f.method || "اتصال"}] ملاحظات: ${f.note || "متابعة"} (النتيجة: ${f.result || "غير محدد"}) (الملخص: ${f.salesBrief || "لا يوجد"})`;
  }).join("\n");

  const todayStr = new Date().toISOString().split("T")[0];

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
- المصدر: ${client.source || "غير محدد"}
- الكورس المطلوب / الخدمة: ${client.bookedCourseName || client.serviceName || "كورس جرافيك ديزاين"}
- الدولة: ${client.country || "مصر"}
- الملاحظات المسجلة: ${client.notes || "لا يوجد"}
- تاريخ إنشاء البروفايل: ${client.createdAt ? new Date(client.createdAt).toLocaleDateString("ar-EG") : "غير محدد"}

سجل المتابعة والمكالمات السابقة:
${historyText || "لا توجد متابعات سابقة بعد"}

---
المطلوب منك تحليل العميل وتوليد توصية وسيناريو مبيعات احترافي باللغة العربية (بالنبرة المصرية الدافئة والمقنعة لأكاديمية صابر جروب):
1. **suggestedDate**: موعد المتابعة القادمة الأنسب بتاريخ مستقبلي (YYYY-MM-DD).
2. **suggestedTime**: ساعة المتابعة (HH:MM).
3. **suggestedChannel**: قناة التواصل الأنسب (واتساب / اتصال هاتفي / مقابلة في المقر / رسالة نصية).
4. **suggestedPitch**: سيناريو رسالة إقناع مخصص ومكتوب بالنبرة المصرية الدافئة لأكاديمية صابر جروب (يشمل التطمين، الإشارة للبورتفوليو أو التقسيط أو كوبون الـ 400 جنيه الخاص بالمساعد الذكي مارو، مع دعوتهم للتواصل عبر واتساب 01040784390 للحجز).
5. **conversionPriority**: أولوية تحويل العميل ('عالي' / 'متوسط' / 'منخفض').
6. **insightsSummary**: ملخص سريع لسلوك ورغبة العميل واعتراضاته المحتملة بناءً على سجله والدورة المطلوبة.
7. **salesTip**: نصيحة مبيعات ذهبية للمسؤول المتابع للتعامل مع هذا العميل وإغلاق الصفقة.`;

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
              salesTip: { type: Type.STRING },
            },
            required: ["suggestedDate", "suggestedChannel", "suggestedPitch", "conversionPriority", "insightsSummary", "salesTip"],
          },
        },
      });

      const jsonStr = response.text?.trim();
      if (jsonStr) {
        return res.json(JSON.parse(jsonStr));
      }
    } catch (err) {
      const isQuotaOrAuth = err?.status === 429 || err?.message?.includes("429") || err?.message?.includes("prepayment") || err?.message?.includes("quota");
      if (isQuotaOrAuth) {
        return res.json(generateFallbackClientAnalysis(client));
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  return res.json(generateFallbackClientAnalysis(client));
});

// ---------------------------------------------------------------------------
// Automation bridge: hourly n8n workflow → Chatwoot idle-conversation AI
// extraction → this function. Upserts a Client (by phone, dedup-safe) and
// logs a follow-up entry, without ever touching staff's native
// WhatsApp/Messenger/Instagram apps or Chatwoot's own UI.
//
// Auth: shared secret in the "x-automation-secret" header (or
// req.body.automationSecret), compared against AUTOMATION_SECRET env var.
//
// Deliberately conservative: never sets isBooked/financial fields and never
// overwrites a status of "not_interested" — those stay human-only decisions.
// If the AI extraction says the customer mentioned booking, that's recorded
// in the follow-up note/salesBrief for a human to close out, not auto-applied.
// ---------------------------------------------------------------------------

const admin = require("firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const ALLOWED_AUTO_STATUSES = ["interested", "potential", "not_interested"];
const ALLOWED_METHODS = ["phone", "whatsapp", "meeting", "other"];
const ALLOWED_SOURCES = ["whatsapp", "messenger", "facebook", "instagram", "tiktok", "google", "other"];
const PLACEHOLDER_NAME_RE = /^(john\s*doe|unknown|غير معروف)$/i;

function mapSuggestedStatus(raw) {
  const key = String(raw || "").toLowerCase().trim();
  if (key === "booked") {
    return { status: "potential", bookedMentioned: true };
  }
  if (ALLOWED_AUTO_STATUSES.includes(key)) {
    return { status: key, bookedMentioned: false };
  }
  return { status: "potential", bookedMentioned: false };
}

function mapMethod(raw) {
  const key = String(raw || "").toLowerCase().trim();
  return ALLOWED_METHODS.includes(key) ? key : "whatsapp";
}

function mapSource(raw) {
  const key = String(raw || "").toLowerCase().trim();
  return ALLOWED_SOURCES.includes(key) ? key : "other";
}

/** Mirrors ClientsList.tsx's handleAddClient phone normalization exactly. */
function normalizeIncomingPhone(rawPhone, countryCode) {
  if (!rawPhone) return null;
  const cc = countryCode || "+20";
  let digits = String(rawPhone).replace(/\D/g, "");
  if (!digits) return null;
  const ccDigits = cc.replace(/\D/g, "");
  if (ccDigits && digits.startsWith(ccDigits)) {
    digits = digits.substring(ccDigits.length);
  }
  digits = digits.replace(/^0+/, "");
  if (!digits) return null;
  return cc + digits;
}

/** Mirrors ClientsList.tsx's dedup phoneVariations logic exactly. */
function buildPhoneVariations(phoneFull) {
  const digitsOnly = phoneFull.replace(/\D/g, "");
  const variations = new Set([phoneFull, digitsOnly]);
  if (phoneFull.startsWith("+20")) {
    const core = phoneFull.substring(3);
    variations.add("0" + core);
    variations.add(core);
    variations.add("20" + core);
  } else if (digitsOnly.startsWith("20")) {
    const core = digitsOnly.substring(2);
    variations.add("+20" + core);
    variations.add("0" + core);
    variations.add(core);
  }
  return Array.from(variations).slice(0, 10);
}

let cachedDefaultAgent = null;
let cachedDefaultAgentAt = 0;
async function getDefaultAutomationAgent() {
  const now = Date.now();
  if (cachedDefaultAgent && now - cachedDefaultAgentAt < 10 * 60 * 1000) {
    return cachedDefaultAgent;
  }
  const email = process.env.AUTOMATION_DEFAULT_AGENT_EMAIL || "sabergroup.eg@gmail.com";
  try {
    const snap = await db.collection("users").where("email", "==", email).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      cachedDefaultAgent = { id: doc.id, name: doc.data().name || "الإدارة" };
      cachedDefaultAgentAt = now;
      return cachedDefaultAgent;
    }
  } catch (e) {
    console.error("getDefaultAutomationAgent lookup failed:", e);
  }
  cachedDefaultAgent = { id: "automation", name: "نظام الأتمتة" };
  cachedDefaultAgentAt = now;
  return cachedDefaultAgent;
}

async function findAgentByName(rawName) {
  if (!rawName || !String(rawName).trim()) return null;
  const target = String(rawName).trim().toLowerCase();
  try {
    const snap = await db.collection("users").get();
    let match = null;
    snap.forEach((doc) => {
      if (match) return;
      const name = (doc.data().name || "").toString().trim().toLowerCase();
      if (!name) return;
      if (name === target || name.includes(target) || target.includes(name)) {
        match = { id: doc.id, name: doc.data().name };
      }
    });
    return match;
  } catch (e) {
    console.error("findAgentByName lookup failed:", e);
    return null;
  }
}

async function matchLabelIds(suggestedLabels) {
  if (!Array.isArray(suggestedLabels) || suggestedLabels.length === 0) return [];
  try {
    const snap = await db.collection("labels").get();
    const allLabels = snap.docs.map((d) => ({ id: d.id, text: (d.data().text || "").toString() }));
    const matched = [];
    for (const raw of suggestedLabels) {
      const needle = String(raw || "").trim().toLowerCase();
      if (!needle) continue;
      const hit = allLabels.find(
        (l) => l.text.toLowerCase() === needle || l.text.toLowerCase().includes(needle) || needle.includes(l.text.toLowerCase())
      );
      if (hit) matched.push(hit.id);
    }
    return Array.from(new Set(matched));
  } catch (e) {
    console.error("matchLabelIds failed:", e);
    return [];
  }
}

const NO_SERVICE_MATCH_RE = /^(أخرى|other|unspecified)$/i;

async function matchService(suggestedServiceName) {
  const generic = { serviceId: "", serviceName: "غير محدد (رصد تلقائي)" };
  const fallback = { serviceId: "", serviceName: suggestedServiceName ? String(suggestedServiceName).trim() : "غير محدد (رصد تلقائي)" };
  if (!suggestedServiceName || NO_SERVICE_MATCH_RE.test(String(suggestedServiceName).trim())) return generic;
  try {
    const snap = await db.collection("services").where("isActive", "==", true).get();
    const needle = String(suggestedServiceName).trim().toLowerCase();
    const hit = snap.docs.find((d) => {
      const name = (d.data().name || "").toString().toLowerCase();
      return name === needle || name.includes(needle) || needle.includes(name);
    });
    if (hit) return { serviceId: hit.id, serviceName: hit.data().name };
    return fallback;
  } catch (e) {
    console.error("matchService failed:", e);
    return fallback;
  }
}

async function postMetaLeadEvent(phoneFull, contentName, contentCategory) {
  const metaPixelId = process.env.META_PIXEL_ID || "";
  const metaAccessToken = process.env.META_ACCESS_TOKEN || "";
  if (!metaPixelId || !metaAccessToken) return;
  try {
    const eventData = {
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "system_generated",
      user_data: { ph: [hashForMeta(phoneFull.replace(/\D/g, ""))] },
      custom_data: { content_name: contentName || "", content_category: contentCategory || "automation" },
    };
    await fetch(`https://graph.facebook.com/v21.0/${metaPixelId}/events?access_token=${encodeURIComponent(metaAccessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [eventData] }),
    });
  } catch (e) {
    console.error("postMetaLeadEvent failed (non-fatal):", e);
  }
}

/**
 * Read-only lookup for the n8n automation: the live, active services catalog,
 * so the Gemini extraction step can semantically match a customer's own wording
 * against the real course list instead of a hardcoded name list baked into the prompt.
 */
exports.getActiveServicesForAutomation = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  const expectedSecret = process.env.AUTOMATION_SECRET || "";
  const providedSecret = req.get("x-automation-secret") || "";
  if (!expectedSecret) {
    return res.status(500).json({ error: "AUTOMATION_SECRET not configured on server" });
  }
  if (providedSecret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const snap = await db.collection("services").where("isActive", "==", true).get();
    const services = snap.docs.map((d) => ({
      id: d.id,
      name: d.data().name || "",
      description: d.data().description || "",
    }));
    return res.json({ services });
  } catch (e) {
    console.error("getActiveServicesForAutomation failed:", e);
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
});

/**
 * Called by the n8n hourly-idle-conversation workflow. Body shape (all from
 * the AI extraction step run over a Chatwoot conversation transcript):
 * {
 *   customer_phone, customer_name, country_code,
 *   sales_brief, detailed_result,
 *   suggested_status, suggested_labels[], suggested_service,
 *   booked, next_followup_date, next_followup_channel,
 *   has_meaningful_content, missing_or_ambiguous_fields[],
 *   source, chatwoot_conversation_id, chatwoot_conversation_link
 * }
 */
exports.upsertClientFromAutomation = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expectedSecret = process.env.AUTOMATION_SECRET || "";
  const providedSecret = req.get("x-automation-secret") || (req.body && req.body.automationSecret) || "";
  if (!expectedSecret) {
    return res.status(500).json({ error: "AUTOMATION_SECRET not configured on server" });
  }
  if (providedSecret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body || {};
  const hasMeaningfulContent = body.has_meaningful_content !== false;

  if (!hasMeaningfulContent) {
    return res.json({ success: true, action: "skipped", reason: "not_meaningful" });
  }

  let phoneFull = normalizeIncomingPhone(body.customer_phone, body.country_code || "+20");
  const isWhatsAppSource = mapSource(body.source) === "whatsapp";
  const hasChatwootContactId = !!body.chatwoot_contact_id;
  if (!phoneFull && (isWhatsAppSource || !hasChatwootContactId)) {
    console.log("upsertClientFromAutomation: skipped, no valid phone. conversation:", body.chatwoot_conversation_id);
    return res.json({
      success: true,
      action: "skipped",
      reason: "no_phone",
      note_for_agent: "تمت معالجة المحادثة تلقائيًا لكن بدون رقم هاتف واضح — تحتاج مراجعة يدوية.",
    });
  }

  try {
    if (body.chatwoot_conversation_id) {
      const alreadyProcessed = await db
        .collection("clients")
        .where("chatId", "==", String(body.chatwoot_conversation_id))
        .limit(1)
        .get();
      if (!alreadyProcessed.empty) {
        return res.json({
          success: true,
          action: "skipped",
          reason: "conversation_already_processed",
          clientId: alreadyProcessed.docs[0].id,
        });
      }
    }

    let existingSnap;
    if (phoneFull) {
      const variations = buildPhoneVariations(phoneFull);
      existingSnap = await db.collection("clients").where("phone", "in", variations).limit(1).get();
    } else {
      existingSnap = await db.collection("clients").where("chatwootContactId", "==", String(body.chatwoot_contact_id)).limit(1).get();
    }
    const { status: mappedStatus, bookedMentioned } = mapSuggestedStatus(body.suggested_status);
    const mappedMethod = mapMethod(body.next_followup_channel);
    const mappedSource = mapSource(body.source);
    const defaultAgent = await getDefaultAutomationAgent();
    const requestedAgent = body.sales_rep_name ? await findAgentByName(body.sales_rep_name) : null;
    const resolvedAgent = requestedAgent || defaultAgent;
    const matchedLabelIds = await matchLabelIds(body.suggested_labels);

    let nextFollowUpTs = 0;
    if (body.next_followup_date) {
      const parsed = new Date(body.next_followup_date).getTime();
      if (!Number.isNaN(parsed)) nextFollowUpTs = parsed;
    }

    if (!existingSnap.empty) {
      // ----- Existing client: log a follow-up, apply conservative updates -----
      const existingDoc = existingSnap.docs[0];
      const existingClient = existingDoc.data();
      const batch = db.batch();

      const updateData = {
        lastFollowUpDate: Date.now(),
      };

      if (existingClient.status !== "not_interested") {
        updateData.status = mappedStatus;
      }
      if (matchedLabelIds.length > 0) {
        updateData.labels = Array.from(new Set([...(existingClient.labels || []), ...matchedLabelIds]));
      }
      if (!existingClient.nextFollowUpDate || existingClient.nextFollowUpDate < Date.now()) {
        if (nextFollowUpTs) {
          updateData.nextFollowUpDate = nextFollowUpTs;
          updateData.nextFollowUpMethod = mappedMethod;
        }
      }
      if (
        body.customer_name &&
        body.customer_name.trim() &&
        (!existingClient.name || PLACEHOLDER_NAME_RE.test(existingClient.name.trim()))
      ) {
        updateData.name = body.customer_name.trim();
      }
      if (!existingClient.position && body.position && String(body.position).trim()) {
        updateData.position = String(body.position).trim();
      }
      if (!existingClient.chatId && body.chatwoot_conversation_id) {
        updateData.chatId = String(body.chatwoot_conversation_id);
      }
      if (!existingClient.profileLink && body.profile_link && String(body.profile_link).trim()) {
        updateData.profileLink = String(body.profile_link).trim();
      }

      batch.update(existingDoc.ref, updateData);

      const followUpRef = db.collection("followups").doc();
      batch.set(followUpRef, {
        clientId: existingDoc.id,
        clientName: updateData.name || existingClient.name || "عميل",
        agentId: resolvedAgent.id,
        agentName: `${resolvedAgent.name} (تحليل تلقائي)`,
        note: body.detailed_result || body.sales_brief || "تحليل تلقائي لمحادثة غير نشطة",
        result: bookedMentioned ? "العميل ذكر رغبته في الحجز - يحتاج تأكيد ودفع من موظف" : "متابعة تلقائية من تحليل المحادثة",
        salesBrief: body.sales_brief || "",
        method: mappedMethod,
        timestamp: Date.now(),
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 0,
        scheduledTime: existingClient.nextFollowUpDate || 0,
        delayStatus: "on_time",
        appointmentId: null,
        isAutomated: true,
        chatwootConversationId: body.chatwoot_conversation_id || null,
      });

      await batch.commit();
      return res.json({ success: true, action: "updated_existing", clientId: existingDoc.id, bookedMentioned });
    }

    // ----- New client -----
    const serviceMatch = await matchService(body.suggested_service);
    const cleanName =
      body.customer_name && body.customer_name.trim() && !PLACEHOLDER_NAME_RE.test(body.customer_name.trim())
        ? body.customer_name.trim()
        : "عميل تلقائي (بانتظار المراجعة)";

    const newClientRef = db.collection("clients").doc();
    const newClientData = {
      name: cleanName,
      position: body.position && String(body.position).trim() ? String(body.position).trim() : "",
      phone: phoneFull || "",
      chatwootContactId: body.chatwoot_contact_id ? String(body.chatwoot_contact_id) : null,
      chatId: body.chatwoot_conversation_id ? String(body.chatwoot_conversation_id) : null,
      gender: ["male", "female", "unspecified"].includes(body.gender) ? body.gender : "unspecified",
      laptop: ["with", "without", "unspecified"].includes(body.has_laptop) ? body.has_laptop : "unspecified",
      mode: ["online", "offline", "unspecified"].includes(body.attendance_mode) ? body.attendance_mode : "unspecified",
      status: mappedStatus,
      serviceId: serviceMatch.serviceId,
      serviceName: serviceMatch.serviceName,
      labels: matchedLabelIds,
      salesAgentId: resolvedAgent.id,
      salesAgentName: resolvedAgent.name,
      createdAt: Date.now(),
      country: "مصر",
      countryCode: body.country_code || "+20",
      source: mappedSource,
      profileLink: body.profile_link ? String(body.profile_link).trim() : "",
      preferredMethod: mappedMethod,
      notes: [
        "🤖 تم إنشاء هذا العميل تلقائيًا من تحليل محادثة غير نشطة (Chatwoot).",
        body.sales_brief ? `الملخص: ${body.sales_brief}` : "",
        Array.isArray(body.missing_or_ambiguous_fields) && body.missing_or_ambiguous_fields.length
          ? `بيانات ناقصة/غير واضحة: ${body.missing_or_ambiguous_fields.join("، ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
    if (nextFollowUpTs) {
      newClientData.nextFollowUpDate = nextFollowUpTs;
      newClientData.nextFollowUpMethod = mappedMethod;
    }

    const batch = db.batch();
    batch.set(newClientRef, newClientData);

    const followUpRef = db.collection("followups").doc();
    batch.set(followUpRef, {
      clientId: newClientRef.id,
      clientName: cleanName,
      agentId: resolvedAgent.id,
      agentName: `${resolvedAgent.name} (تحليل تلقائي)`,
      note: body.detailed_result || body.sales_brief || "عميل جديد تم رصده تلقائيًا",
      result: bookedMentioned ? "العميل ذكر رغبته في الحجز - يحتاج تأكيد ودفع من موظف" : "عميل جديد من تحليل تلقائي",
      salesBrief: body.sales_brief || "",
      method: mappedMethod,
      timestamp: Date.now(),
      startTime: Date.now(),
      endTime: Date.now(),
      duration: 0,
      scheduledTime: 0,
      delayStatus: "on_time",
      appointmentId: null,
      isAutomated: true,
      chatwootConversationId: body.chatwoot_conversation_id || null,
    });

    const logRef = db.collection("logs").doc();
    batch.set(logRef, {
      userId: resolvedAgent.id,
      userName: `${resolvedAgent.name} (تحليل تلقائي)`,
      action: `إضافة عميل جديد تلقائيًا (${mappedSource}): ${cleanName}`,
      targetId: newClientRef.id,
      targetName: cleanName,
      timestamp: Date.now(),
    });

    await batch.commit();
    if (phoneFull) {
      postMetaLeadEvent(phoneFull, cleanName, mappedSource);
    }

    return res.json({ success: true, action: "created_new", clientId: newClientRef.id, bookedMentioned });
  } catch (error) {
    console.error("upsertClientFromAutomation error:", error);
    return res.status(500).json({ error: error?.message || "Unknown error in upsertClientFromAutomation" });
  }
});
