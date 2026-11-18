const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const { automationKeyOk } = require("./automationKey");
const { OAuth2Client, GoogleAuth } = require("google-auth-library");
const accountingIngest = require("./accountingIngest");
const automationUpsert = require("./automationUpsert");
const agentMatch = require("./agentMatch");
const metaCapi = require("./metaCapi");
const crmExport = require("./crmExport");
const crmAssistant = require("./crmAssistant");
const clientSnapshot = require("./clientSnapshot");
const { defineSecret } = require("firebase-functions/params");

// Claude key for the CRM assistant (Firebase secret in this project).
const ANTHROPIC_API_KEY_CRM = defineSecret("ANTHROPIC_API_KEY_CRM");

function hashForMeta(value) {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Reports Lead/Purchase events straight from the CRM to Meta's Conversions API,
 * so Meta Ads can optimize on real bookings/payments instead of only ad clicks.
 * Called from SG-CRM's metaService.ts.
 */
// The AI and Meta endpoints used to be open to anyone on the internet. They now need
// either an active staff member's Firebase ID token (what the CRM web app sends) or
// the automation secret (server-to-server callers such as n8n).
async function requireStaffOrAutomation(req, res) {
  if (automationKeyOk(req.get("x-automation-secret"))) return { automation: true };
  const match = (req.get("authorization") || "").match(/^Bearer (.+)$/);
  if (!match) {
    res.status(401).json({ error: "Sign in required" });
    return null;
  }
  try {
    const token = await admin.auth().verifyIdToken(match[1]);
    const email = String(token.email || "").toLowerCase();
    if (email === "saber.gd.fl@gmail.com" && token.email_verified === true) return { uid: token.uid, email };
    const snap = await db.collection("users").doc(token.uid).get();
    if (!snap.exists || snap.data().isDeactivated === true) {
      res.status(403).json({ error: "Account is not active" });
      return null;
    }
    return { uid: token.uid, email };
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired sign-in" });
    return null;
  }
}

exports.metaCapiEvent = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
  const caller = await requireStaffOrAutomation(req, res);
  if (!caller) return;
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
// AI bridge functions (Claude). The exported names still say "gemini" because the
// live site and the deploy list call them by those names; the model behind them
// is Claude, with the key in Secret Manager (ANTHROPIC_API_KEY_CRM).
// ---------------------------------------------------------------------------

// Daily ceiling per caller for the AI endpoints, so a stuck tab or a looping
// workflow can't run up the bill. Same counter doc keeps the day's token totals.
const AI_DAILY_LIMIT = 400;
const AI_DAILY_LIMIT_AUTOMATION = 1000;

function aiUsageRef(caller) {
  const today = new Date().toISOString().slice(0, 10);
  return db.doc(`ai_usage/${caller.automation ? "automation" : caller.uid}_${today}`);
}

async function takeAiQuota(caller, res) {
  const ref = aiUsageRef(caller);
  const limit = caller.automation ? AI_DAILY_LIMIT_AUTOMATION : AI_DAILY_LIMIT;
  // A counter failure must not take the feature down: let the call through.
  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? snap.data().count || 0 : 0;
    if (count >= limit) return false;
    tx.set(ref, { uid: caller.uid || "automation", date: ref.id.slice(-10), count: count + 1 }, { merge: true });
    return true;
  }).catch((e) => { console.warn("ai quota check failed:", e?.message || e); return true; });
  if (!allowed) res.status(429).json({ error: `وصلت للحد اليومي لتحليلات الذكاء الاصطناعي (${limit}).`, limitReached: true });
  return allowed;
}

const AI_MODEL_FAST = "claude-haiku-5-5";   // scores and short report notes
const AI_MODEL_PITCH = "claude-sonnet-5-5"; // the Arabic sales pitch is customer-facing wording

// Numbers only: no prompt text or client data goes to the log.
async function logAiUsage(task, caller, model, usage, ok) {
  const u = usage || {};
  const inTokens = u.input_tokens || 0, outTokens = u.output_tokens || 0;
  const cacheRead = u.cache_read_input_tokens || 0, cacheWrite = u.cache_creation_input_tokens || 0;
  console.log(JSON.stringify({ aiCall: task, model, ok, inTokens, outTokens, cacheRead, cacheWrite, caller: caller.automation ? "automation" : caller.uid }));
  if (!inTokens && !outTokens) return;
  const inc = admin.firestore.FieldValue.increment;
  await aiUsageRef(caller).set({ inTokens: inc(inTokens), outTokens: inc(outTokens), cacheRead: inc(cacheRead), cacheWrite: inc(cacheWrite) }, { merge: true })
    .catch((e) => console.warn("ai usage log failed:", e?.message || e));
}

// One Claude call. `tool` forces a structured JSON answer; `system` is cached (the
// knowledge base is identical across calls, so repeats read it at a tenth of the price).
async function callClaude({ model, system, prompt, maxTokens, tool }) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (system) body.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  if (tool) { body.tools = [tool]; body.tool_choice = { type: "tool", name: tool.name }; }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY_CRM.value(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const err = new Error(`Claude API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const out = await res.json();
  const content = out.content || [];
  return {
    text: content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(),
    input: content.find((b) => b.type === "tool_use")?.input || null,
    usage: out.usage || {},
  };
}

const AI_FN_OPTIONS = { region: "us-central1", cors: true, secrets: [ANTHROPIC_API_KEY_CRM], timeoutSeconds: 90 };

/**
 * Predicts a lead's conversion likelihood from their status + follow-up history.
 * Mirrors server.ts's POST /api/gemini/predict-sales route.
 */
exports.geminiPredictSales = onRequest(AI_FN_OPTIONS, async (req, res) => {
  const caller = await requireStaffOrAutomation(req, res);
  if (!caller) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { client, followUps } = req.body || {};
    if (!client) {
      return res.status(400).json({ error: "Missing client parameter" });
    }
    if (!(await takeAiQuota(caller, res))) return;

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

    const r = await callClaude({
      model: AI_MODEL_FAST, maxTokens: 400, prompt,
      tool: {
        name: "submit_prediction", description: "Submit the conversion prediction for this lead.",
        input_schema: { type: "object", properties: { score: { type: "string", enum: ["High", "Medium", "Low"] }, reason: { type: "string" }, earlyContactEffect: { type: "string" } }, required: ["score", "reason"] },
      },
    });
    await logAiUsage("predictSales", caller, AI_MODEL_FAST, r.usage, true);
    if (!r.input) {
      return res.json({ score: "Medium", reason: "لم يتم استلام رد من الذكاء الاصطناعي" });
    }
    return res.json(r.input);
  } catch (error) {
    console.error("geminiPredictSales error:", error);
    return res.json({ score: "Medium", reason: "فرصة تحويل متوسطة - بناءً على بيانات العميل وسجل المتابعات" });
  }
});

/**
 * Generates a short Arabic performance analysis for a daily sales report.
 * Mirrors server.ts's POST /api/gemini/analyze-report route.
 */
exports.geminiAnalyzeReport = onRequest(AI_FN_OPTIONS, async (req, res) => {
  const caller = await requireStaffOrAutomation(req, res);
  if (!caller) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { report } = req.body || {};
    if (!report) {
      return res.status(400).json({ error: "Missing report parameter" });
    }
    if (!(await takeAiQuota(caller, res))) return;

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

    const r = await callClaude({ model: AI_MODEL_FAST, maxTokens: 300, prompt });
    await logAiUsage("analyzeReport", caller, AI_MODEL_FAST, r.usage, true);
    return res.json({ text: r.text || "تم تسجيل التقرير بنجاح. ينصح بالتركيز على سرعة التواصل مع الجدد." });
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
exports.geminiAnalyzeClient = onRequest(AI_FN_OPTIONS, async (req, res) => {
  const caller = await requireStaffOrAutomation(req, res);
  if (!caller) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { client, followUps } = req.body || {};
  if (!client) {
    return res.status(400).json({ error: "Missing client parameter" });
  }
  if (!(await takeAiQuota(caller, res))) return;

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

  // Fixed part (role + knowledge base + task) goes in the cached system prompt;
  // only the client data changes between calls.
  const system = `أنت المساعد الذكي ورئيس فريق المبيعات الأكاديمي (AI Sales Lead & Advisor) لأكاديمية صابر جروب (SABER GROUP Courses Academy).

استند بالكامل إلى قاعدة معرفة صابر جروب التالية عند تحليل بيانات العميل واقتراح خطوات المبيعات:
${SABER_KNOWLEDGE_BASE}

تنبيه هام جداً بخصوص حالة العميل:
- إذا كانت حالة العميل هي (حجز / booked / مسجل / تم الحجز / enrolled)، فهذا يعني أن العميل قام بالشراء والانضمام للكورس بالفعل، وبالتالي تمت عملية البيع بنجاح وهو غير مستهدف بعروض بيعية جديدة، بل تكون التوصية للترحيب به كطالب وتوجيهه لقنوات الدعم الأكاديمي.
- أما إذا كانت حالته (مهتم / محتمل / interested / potential)، فهو العميل المستهدف الرئيسي بالمتابعات البيعية والعروض والتأكيد على الحجز والتقسيط وكوبون الخصم.

المطلوب منك تحليل العميل وتوليد توصية وسيناريو مبيعات احترافي باللغة العربية (بالنبرة المصرية الدافئة والمقنعة لأكاديمية صابر جروب):
1. **suggestedDate**: موعد المتابعة القادمة الأنسب بتاريخ مستقبلي (YYYY-MM-DD).
2. **suggestedTime**: ساعة المتابعة (HH:MM).
3. **suggestedChannel**: قناة التواصل الأنسب (واتساب / اتصال هاتفي / مقابلة في المقر / رسالة نصية).
4. **suggestedPitch**: سيناريو رسالة إقناع مخصص ومكتوب بالنبرة المصرية الدافئة لأكاديمية صابر جروب (يشمل التطمين، الإشارة للبورتفوليو أو التقسيط أو كوبون الـ 400 جنيه الخاص بالمساعد الذكي مارو، مع دعوتهم للتواصل عبر واتساب 01040784390 للحجز).
5. **conversionPriority**: أولوية تحويل العميل ('عالي' / 'متوسط' / 'منخفض').
6. **insightsSummary**: ملخص سريع لسلوك ورغبة العميل واعتراضاته المحتملة بناءً على سجله والدورة المطلوبة.
7. **salesTip**: نصيحة مبيعات ذهبية للمسؤول المتابع للتعامل مع هذا العميل وإغلاق الصفقة.

سلّم النتيجة عن طريق الأداة submit_recommendation فقط.`;

  const prompt = `تاريخ اليوم الحالي: ${todayStr}.

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
${historyText || "لا توجد متابعات سابقة بعد"}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await callClaude({
        model: AI_MODEL_PITCH, maxTokens: 1500, system, prompt,
        tool: {
          name: "submit_recommendation", description: "Submit the follow-up recommendation for this client.",
          input_schema: {
            type: "object",
            properties: {
              suggestedDate: { type: "string", description: "YYYY-MM-DD" },
              suggestedTime: { type: "string", description: "HH:MM" },
              suggestedChannel: { type: "string" },
              suggestedPitch: { type: "string" },
              conversionPriority: { type: "string", enum: ["عالي", "متوسط", "منخفض"] },
              insightsSummary: { type: "string" },
              salesTip: { type: "string" },
            },
            required: ["suggestedDate", "suggestedChannel", "suggestedPitch", "conversionPriority", "insightsSummary", "salesTip"],
          },
        },
      });

      await logAiUsage("analyzeClient", caller, AI_MODEL_PITCH, r.usage, true);
      if (r.input) {
        return res.json(r.input);
      }
    } catch (err) {
      console.error("analyzeClient AI error:", err?.message || err);
      // Bad key, no credit or rate limit: a second try won't help.
      if ([400, 401, 403, 429].includes(err?.status)) {
        return res.json({ ...generateFallbackClientAnalysis(client), fallback: true });
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  return res.json({ ...generateFallbackClientAnalysis(client), fallback: true });
});

// ---------------------------------------------------------------------------
// Automation bridge: hourly n8n workflow → Chatwoot idle-conversation AI
// extraction → this function. Upserts a Client (by phone, dedup-safe) and
// logs a follow-up entry, without ever touching staff's native
// WhatsApp/Messenger/Instagram apps or Chatwoot's own UI.
//
// Auth: shared secret in the "x-automation-secret" header (or
// req.body.automationSecret), checked by automationKey.js.
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
const { planAccountingBookingSync } = require("./accountingSync");

const ALLOWED_METHODS = ["phone", "whatsapp", "meeting", "other"];
const ALLOWED_SOURCES = ["whatsapp", "messenger", "facebook", "instagram", "tiktok", "google", "other"];
const PLACEHOLDER_NAME_RE = /^(john\s*doe|unknown|user|غير معروف|عميل تلقائي(?:\s*[-(].*)?)$/i;
const { normalizeIncomingPhone, buildPhoneVariations } = automationUpsert;

function mapMethod(raw) {
  const key = String(raw || "").toLowerCase().trim();
  return ALLOWED_METHODS.includes(key) ? key : "whatsapp";
}

function mapSource(raw) {
  const key = String(raw || "").toLowerCase().trim();
  return ALLOWED_SOURCES.includes(key) ? key : "other";
}

// Small per-instance cache for reference data (users, labels, config docs): one read per
// 5 minutes per warm instance instead of one per call.
const refCache = new Map(); // key -> { at, value }
const REF_CACHE_MS = 5 * 60 * 1000;
async function cachedRef(key, load, ttl = REF_CACHE_MS) {
  const hit = refCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await load();
  refCache.set(key, { at: Date.now(), value });
  return value;
}

const cachedUsers = () => cachedRef("users", async () =>
  (await db.collection("users").get()).docs.map((d) => {
    const u = d.data() || {};
    return { id: d.id, name: u.name || "", email: u.email || "", role: u.role || "", isDeactivated: u.isDeactivated === true };
  }));

const cachedLabels = () => cachedRef("labels", async () =>
  (await db.collection("labels").get()).docs.map((d) => ({ id: d.id, text: String(d.data().text || "") })));

// app_settings/salesNameAliases = { aliases: { "<name as another system writes it>": "<CRM uid or CRM name>" } }.
// Seeded with scripts/seed-sales-aliases.cjs; missing doc = no aliases.
const cachedSalesAliases = () => cachedRef("salesNameAliases", async () => {
  const snap = await db.collection("app_settings").doc("salesNameAliases").get();
  return agentMatch.normalizeAliasMap(snap.exists ? snap.data() : null);
});

const ACCOUNTING_PROJECT_ID = "crm---acounting-sg";
const accountingAuthApp = admin.apps.find((app) => app.name === "accounting-auth") ||
  admin.initializeApp({ projectId: ACCOUNTING_PROJECT_ID }, "accounting-auth");

function firestoreValue(value) {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("mapValue" in value) return firestoreFields(value.mapValue.fields || {});
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(firestoreValue);
  return null;
}

function firestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)]));
}

async function accountingDocument(path, token) {
  const url = `https://firestore.googleapis.com/v1/projects/${ACCOUNTING_PROJECT_ID}/databases/(default)/documents/${path}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Accounting document read failed (${response.status})`);
  return firestoreFields((await response.json()).fields || {});
}

async function authorizedAccountingUser(req, needsBookingPermission = false) {
  const match = /^Bearer (.+)$/i.exec(req.get("authorization") || "");
  if (!match) return null;
  const token = match[1];
  const decoded = await admin.auth(accountingAuthApp).verifyIdToken(token);
  const email = String(decoded.email || "").trim().toLowerCase();
  if (!email) return null;
  const [profile, allowed] = await Promise.all([
    accountingDocument(`users/${encodeURIComponent(decoded.uid)}`, token),
    accountingDocument(`allowed_users/${encodeURIComponent(email)}`, token),
  ]);
  if (!profile?.isActive || profile.email?.toLowerCase() !== email) return null;
  if (email !== "saber.gd.fl@gmail.com" && !allowed?.isActive) return null;
  if (needsBookingPermission) {
    const permissions = await accountingDocument("settings/permissions", token);
    const defaultAllowed = ["admin", "supervisor", "manager", "training_team_leader"].includes(profile.role);
    if (!(permissions?.createBookings?.[profile.role] ?? defaultAllowed)) return null;
  }
  return { token, uid: decoded.uid, email };
}

async function findClientForAccounting(phone, countryCode) {
  const normalized = normalizeIncomingPhone(phone, countryCode);
  if (!normalized) return null;
  const matches = await db.collection("clients").where("phone", "in", buildPhoneVariations(normalized)).limit(2).get();
  if (matches.empty) return null;
  if (matches.size !== 1) return { ambiguous: matches.size > 1 };
  const doc = matches.docs[0];
  return { id: doc.id, data: doc.data() };
}

// ---------------------------------------------------------------------------
// Accounting -> CRM automatic sync. The accounting project's Cloud Function calls this with a
// Google-signed ID token; only its own runtime service account is accepted.
// ---------------------------------------------------------------------------
const BRIDGE_URL = "https://us-central1-sg-crm-e3a38.cloudfunctions.net/accountingCrmBridge";
const ACCOUNTING_RUNTIME_SA = "919641001193-compute@developer.gserviceaccount.com";
const oidcClient = new OAuth2Client();

async function verifyAccountingService(req) {
  const match = /^Bearer (.+)$/i.exec(req.get("authorization") || "");
  if (!match) return false;
  try {
    const ticket = await oidcClient.verifyIdToken({ idToken: match[1], audience: BRIDGE_URL });
    const payload = ticket.getPayload();
    return payload.email_verified === true && payload.email === ACCOUNTING_RUNTIME_SA;
  } catch (e) {
    return false;
  }
}

// Automatic personal follow-up every 2 weeks (shared ESM module, loaded once per instance).
let autoFollowUp = null;
const loadAutoFollowUp = async () => (autoFollowUp = autoFollowUp || (await import("./autoFollowUp.mjs")));

// Activity-log entry for the automatic 2-week follow-up being switched on/off by accounting.
function autoFollowUpLog(auto, clientId, clientName, now) {
  const on = auto.autoFollowUp.enabled;
  return { userId: autoFollowUp.ACCOUNTING_ACTOR.by, userName: autoFollowUp.ACCOUNTING_ACTOR.byName,
    action: on ? "تشغيل المتابعة التلقائية كل أسبوعين (حجز من الحسابات)" : `إيقاف المتابعة التلقائية: ${autoFollowUp.ACCOUNTING_STOP_REASON}`,
    targetId: clientId, targetName: clientName || "", timestamp: now };
}

// The writes that apply one accounting booking summary to a CRM client (inside a transaction).
// Shared by the normal ingest, a resolved sync_review, a create race and linkSyncReview, so
// every path computes money, booking status and the 2-week follow-up the same way.
function planSummaryWrite(current, summary, { now, bookingId }) {
  const plan = accountingIngest.planClientAccounting(current, summary, now);
  // On for a new/recent booking, off when no booking is ACTIVE any more; null = no change
  // (repeat syncs of the same booking never touch it, so this cannot loop or pile up).
  const auto = autoFollowUp.planAccountingAutoFollowUp(current, plan.patch, { now, bookingId }, admin.firestore.FieldValue.delete());
  return {
    plan, auto,
    update: { ...plan.patch, ...(auto || {}), accountingBookingIds: admin.firestore.FieldValue.arrayUnion(bookingId) },
  };
}

// One audit document per booking (overwritten on each sync, with a counter) so the collection
// never grows with repeated syncs.
function accountingAuditRef(bookingId) {
  return db.collection("integrationEvents").doc(`accounting_sync_${bookingId}`);
}
function accountingAuditFields(bookingId, summary, now, extra) {
  return {
    correlationId: `accounting_booking_${bookingId}`, sourceSystem: "accounting", targetSystem: "crm", eventType: "booking_synced",
    sourceRef: bookingId, processedAt: now, bookingStatus: summary.status, syncCount: admin.firestore.FieldValue.increment(1), ...extra,
  };
}

// Applies the summary to an existing client in one transaction. { missing } when the client is
// gone, { stale } when the client already holds a newer version of this booking.
async function applySummaryToClient(clientRef, summary, { now, bookingId }) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(clientRef);
    if (!snap.exists) return { missing: true };
    const current = snap.data() || {};
    if (accountingIngest.isStaleSummary(current, summary)) return { stale: true, changedFields: [] };
    const { plan, auto, update } = planSummaryWrite(current, summary, { now, bookingId });
    tx.update(clientRef, update);
    if (auto) tx.set(db.collection("logs").doc(), autoFollowUpLog(auto, clientRef.id, current.name, now));
    return { ...plan, autoFollowUp: auto ? (auto.autoFollowUp.enabled ? "enabled" : "disabled") : null };
  });
}

// Creates the client for a booking nobody had, under a deterministic id and a per-phone lock
// (client_locks/pk_<phoneKey>, server-only), so two concurrent syncs for the same new customer
// cannot create two clients. Returns { createdId } or { existingId } (then the caller updates it).
async function createClientFromBooking({ customer, booking, summary, bookingId, now, customerId }) {
  const agent = (await findAgentByName(booking.salesName)) || (await getDefaultAutomationAgent());
  const created = accountingIngest.newClientFromBooking(customer, summary, agent, now);
  created.searchKeys = (await import("./searchKeys.mjs")).buildSearchKeys(created.name, created.phone);
  const phoneKey = created.phoneKey || accountingIngest.customerPhoneKeys(customer)[0] || "";
  const clientId = accountingIngest.accountingClientId(customerId, phoneKey);
  if (!clientId || !phoneKey) throw new Error("no deterministic id for the new client");
  const clientRef = db.collection("clients").doc(clientId);
  const lockRef = db.collection("client_locks").doc(`pk_${phoneKey}`);
  // Personal follow-up every 2 weeks for a recent booking (no delete sentinels in a new doc).
  const autoOn = autoFollowUp.planAccountingAutoFollowUp({}, created, { now, bookingId });
  return db.runTransaction(async (tx) => {
    const [lockSnap, clientSnap] = await Promise.all([tx.get(lockRef), tx.get(clientRef)]);
    if (clientSnap.exists) return { existingId: clientRef.id };
    const lockedId = lockSnap.exists ? String(lockSnap.data().clientId || "") : "";
    if (lockedId) {
      const lockedSnap = await tx.get(db.collection("clients").doc(lockedId));
      if (lockedSnap.exists) return { existingId: lockedId };
    }
    tx.set(clientRef, { ...created, ...(autoOn || {}), accountingBookingIds: [bookingId] });
    tx.set(lockRef, { clientId: clientRef.id, phoneKey, bookingId, createdAt: now, by: "accounting_ingest" });
    return { createdId: clientRef.id, autoFollowUp: autoOn ? "enabled" : null };
  });
}

async function handleAccountingIngest(req, res) {
  if (!(await verifyAccountingService(req))) return res.status(403).json({ error: "Not allowed" });
  await loadAutoFollowUp();
  const bookingId = String(req.body?.bookingId || "");
  const booking = req.body?.booking;
  const customer = req.body?.customer && typeof req.body.customer === "object" ? req.body.customer : {};
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(bookingId) || !booking || typeof booking !== "object") return res.status(400).json({ error: "Invalid payload" });

  const now = Date.now();
  const summary = accountingIngest.summarizeBooking(bookingId, booking, req.body?.productName, now);
  const keys = accountingIngest.customerPhoneKeys(customer);
  const customerId = customer.id || booking.customerId || "";
  const reviewRef = db.collection("sync_review").doc(bookingId);
  const review = async (reason, candidates = []) => {
    await reviewRef.set({ bookingId, reason, candidates, keys, summary, customerName: customer.name || "", createdAt: now, resolved: false }, { merge: true });
    // Still a real booking for Meta, even when the CRM client is unclear.
    await reportPurchaseToMeta({ bookingId, booking, customer, summary, clientId: null });
    return res.json({ success: true, action: "queued_for_review", reason });
  };
  const audit = (extra) => accountingAuditRef(bookingId).set(accountingAuditFields(bookingId, summary, now, extra), { merge: true });
  const updated = async (clientRef, via) => {
    const result = await applySummaryToClient(clientRef, summary, { now, bookingId });
    if (result.missing) return null;
    if (result.stale) {
      await audit({ targetRef: clientRef.id, result: "ignored_stale", staleSourceUpdatedAt: summary.sourceUpdatedAt });
      res.json({ success: true, action: "ignored_stale", clientId: clientRef.id });
      return result;
    }
    await audit({ targetRef: clientRef.id, result: "updated_client", via, changedFields: result.changedFields, overwroteFinancials: result.overwroteFinancials, autoFollowUp: result.autoFollowUp });
    await reportPurchaseToMeta({ bookingId, booking, customer, summary, clientId: clientRef.id });
    res.json({ success: true, action: "updated_client", clientId: clientRef.id, changedFields: result.changedFields });
    return result;
  };

  // A manager (or scripts/resolve-review.cjs) already chose the client for this booking: keep
  // applying it there, and keep the review resolved instead of re-opening it.
  const reviewSnap = await reviewRef.get();
  const resolvedClientId = reviewSnap.exists ? String(reviewSnap.data().resolvedClientId || "") : "";
  if (resolvedClientId && /^[A-Za-z0-9_-]{1,128}$/.test(resolvedClientId)) {
    const done = await updated(db.collection("clients").doc(resolvedClientId), "resolved_review");
    if (done) {
      await reviewRef.set({ resolved: true, resolvedAt: reviewSnap.data().resolvedAt || now, summary, lastAppliedAt: now }, { merge: true });
      return;
    }
  }

  if (!keys.length) return review("no_phone");

  const found = new Map();
  for (let i = 0; i < keys.length; i += 10) {
    const snap = await db.collection("clients").where("phoneKey", "in", keys.slice(i, i + 10)).get();
    snap.forEach((d) => found.set(d.id, d));
  }
  if (found.size > 1) return review("ambiguous_phone", [...found.keys()]);

  let clientRef = found.size === 1 ? found.values().next().value.ref : null;
  if (!clientRef) {
    if (summary.status !== "ACTIVE") return res.json({ success: true, action: "ignored_inactive_no_client" });
    const outcome = await createClientFromBooking({ customer, booking, summary, bookingId, now, customerId });
    if (outcome.createdId) {
      await audit({ targetRef: outcome.createdId, result: "created_client", autoFollowUp: outcome.autoFollowUp });
      await reportPurchaseToMeta({ bookingId, booking, customer, summary, clientId: outcome.createdId });
      return res.json({ success: true, action: "created_client", clientId: outcome.createdId });
    }
    // Another sync created this customer a moment ago: update that client instead.
    clientRef = db.collection("clients").doc(outcome.existingId);
  }

  const done = await updated(clientRef, "phone_match");
  if (!done) return review("client_missing", [clientRef.id]);
  if (!done.stale && reviewSnap.exists) await reviewRef.delete().catch(() => {});
}

// ---------------------------------------------------------------------------
// Meta Conversions API: one server-side Purchase per new accounting booking.
// Off until app_settings/metaCapi has enabled: true. With testEventCode set there,
// events only show in Events Manager -> Test events (nothing counts for ads) and are logged
// under a separate test_ document, so going live afterwards still sends the real event.
// metaCapiEvents/{purchase_<bookingId>} makes it once per booking (no customer data stored).
// Never fails the sync.
// ---------------------------------------------------------------------------
let metaCapiSettingsCache = { at: 0, value: null };
async function metaCapiSettings() {
  if (Date.now() - metaCapiSettingsCache.at < 60 * 1000) return metaCapiSettingsCache.value;
  const snap = await db.collection("app_settings").doc("metaCapi").get();
  metaCapiSettingsCache = { at: Date.now(), value: snap.exists ? snap.data() : null };
  return metaCapiSettingsCache.value;
}

async function reportPurchaseToMeta({ bookingId, booking, customer, summary, clientId }) {
  try {
    const settings = await metaCapiSettings();
    if (settings?.enabled !== true) return;
    const pixelId = process.env.META_PIXEL_ID || "";
    const accessToken = process.env.META_ACCESS_TOKEN || "";
    if (!pixelId || !accessToken) return;
    const built = metaCapi.purchaseEventForBooking({ bookingId, booking, customer, summary, clientId });
    if (built.skip) return;
    const testEventCode = String(settings.testEventCode || "").trim();
    const logRef = db.collection("metaCapiEvents").doc(`${testEventCode ? "test_" : ""}purchase_${bookingId}`);
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(logRef);
      const prev = snap.exists ? snap.data() : null;
      // A "sending" left behind by a crashed instance becomes retryable after 10 minutes.
      const inFlight = prev?.status === "sending" && Date.now() - (prev.updatedAt || 0) < 10 * 60 * 1000;
      if (prev && (prev.status === "sent" || inFlight || (prev.attempts || 0) >= 3)) return false;
      tx.set(logRef, {
        eventName: "Purchase", eventId: built.event.event_id, bookingId, clientId: clientId || null, value: summary.total,
        courseName: summary.courseName || "", eventTime: built.event.event_time * 1000, test: !!testEventCode,
        status: "sending", attempts: (prev?.attempts || 0) + 1, updatedAt: Date.now(),
      }, { merge: true });
      return true;
    });
    if (!claimed) return;
    try {
      const out = await metaCapi.sendEvents({ pixelId, accessToken, events: [built.event], testEventCode });
      await logRef.update({ status: "sent", sentAt: Date.now(), eventsReceived: out.eventsReceived, fbtraceId: out.fbtraceId, error: admin.firestore.FieldValue.delete() });
    } catch (err) {
      console.error("meta purchase failed", bookingId, err?.meta || err?.message);
      await logRef.update({ status: "failed", error: err?.meta || { message: String(err?.message || err) }, updatedAt: Date.now() });
    }
  } catch (err) {
    console.error("meta purchase skipped", bookingId, err?.message || err);
  }
}

// Paged, sanitized read of a CRM collection for the accounting data analyst (same service-to-service auth).
async function handleCrmExport(req, res) {
  if (!(await verifyAccountingService(req))) return res.status(403).json({ error: "Not allowed" });
  const collection = String(req.body?.collection || "");
  if (!crmExport.isExportable(collection)) return res.status(400).json({ error: "Collection not exportable" });
  const limit = crmExport.pageSize(req.body?.limit);
  let q = db.collection(collection).orderBy(admin.firestore.FieldPath.documentId()).limit(limit);
  if (req.body?.after) q = q.startAfter(String(req.body.after));
  const snap = await q.get();
  const docs = snap.docs.map((d) => crmExport.sanitizeDoc(collection, d.id, d.data()));
  return res.json({ docs, next: snap.size === limit ? snap.docs[snap.size - 1].id : null });
}

// ---------------------------------------------------------------------------
// "مارو": the CRM assistant (read-only). Signed-in staff only; a sales agent only sees their own clients.
// ---------------------------------------------------------------------------
const assistantCache = new Map(); // scope -> { at, rows } (per warm instance, 3 minutes)

async function assistantStaff(req) {
  const match = /^Bearer (.+)$/i.exec(req.get("authorization") || "");
  if (!match) return null;
  const token = await admin.auth().verifyIdToken(match[1]);
  const email = String(token.email || "").toLowerCase();
  if (email === "saber.gd.fl@gmail.com" && token.email_verified === true) return { uid: token.uid, role: "admin", name: token.name || "الأدمن" };
  const snap = await db.collection("users").doc(token.uid).get();
  if (!snap.exists || snap.data().isDeactivated === true) return null;
  return { uid: token.uid, role: snap.data().role || "sales_agent", name: snap.data().name || "" };
}

async function assistantClients(user) {
  const leader = crmAssistant.isLeader(user.role);
  const key = leader ? "all" : `agent:${user.uid}`;
  const hit = assistantCache.get(key);
  if (hit && Date.now() - hit.at < 3 * 60 * 1000) return hit.rows;
  const base = db.collection("clients");
  const snap = await (leader ? base : base.where("salesAgentId", "==", user.uid)).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  assistantCache.set(key, { at: Date.now(), rows });
  return rows;
}

async function handleAssistant(req, res) {
  let user;
  try { user = await assistantStaff(req); } catch (e) { user = null; }
  if (!user) return res.status(401).json({ error: "سجّل دخولك الأول." });
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length) return res.status(400).json({ error: "اكتب سؤالك." });

  const today = new Date().toISOString().slice(0, 10);
  const usageRef = db.doc(`assistant_usage/${user.uid}_${today}`);
  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const count = snap.exists ? snap.data().count || 0 : 0;
    if (count >= crmAssistant.DAILY_LIMIT) return false;
    tx.set(usageRef, { uid: user.uid, date: today, count: count + 1 }, { merge: true });
    return true;
  });
  if (!allowed) return res.status(429).json({ error: `وصلت للحد اليومي (${crmAssistant.DAILY_LIMIT} رسالة).` });

  try {
    const result = await crmAssistant.runAssistant({
      messages, apiKey: ANTHROPIC_API_KEY_CRM.value(), user,
      data: {
        clients: await assistantClients(user),
        followupsFor: async (id) => (await db.collection("followups").where("clientId", "==", id).limit(40).get()).docs.map((d) => d.data()),
      },
    });
    return res.json(result);
  } catch (error) {
    console.error("assistant failed:", error?.message || error);
    return res.status(500).json({ error: "المساعد مش متاح دلوقتي. جرّب بعد شوية." });
  }
}

// ---------------------------------------------------------------------------
// "ملف العميل": the owner agent (or a leader) pulls accounting + training data for ONE client on
// demand. Server-to-server calls carry a Google OIDC token for the receiving function's URL.
// ---------------------------------------------------------------------------
const googleAuth = new GoogleAuth();
const idTokenClients = new Map(); // audience -> IdTokenClient (per warm instance)
async function oidcTokenFor(audience) {
  let client = idTokenClients.get(audience);
  if (!client) { client = await googleAuth.getIdTokenClient(audience); idTokenClients.set(audience, client); }
  // google-auth-library v10 returns a fetch Headers object, older versions a plain object.
  const headers = await client.getRequestHeaders();
  const value = typeof headers.get === "function" ? headers.get("authorization") : (headers.Authorization || headers.authorization);
  const token = String(value || "").replace(/^Bearer /i, "");
  if (!token) throw new Error("could not mint a Google ID token");
  return token;
}

async function handleClientSnapshot(req, res) {
  let user;
  try { user = await assistantStaff(req); } catch (e) { user = null; }
  if (!user) return res.status(401).json({ error: "سجّل دخولك الأول." });
  try {
    const result = await clientSnapshot.pullClientSnapshot({
      clientId: req.body?.clientId, force: req.body?.force === true, user,
      deps: { store: clientSnapshot.firestoreStore(db), fetchImpl: fetch, getIdToken: oidcTokenFor, apiKey: ANTHROPIC_API_KEY_CRM.value() },
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof clientSnapshot.SnapshotError) return res.status(error.status).json({ error: error.message });
    console.error("client snapshot failed:", error?.message || error);
    return res.status(500).json({ error: "ماقدرناش نسحب ملف العميل دلوقتي. جرّب بعد شوية." });
  }
}

// ---------------------------------------------------------------------------
// Staff actions on the bridge (active staff Firebase ID token, role from users/{uid}).
// ---------------------------------------------------------------------------
const MANAGER_ROLES = ["admin", "administrator", "manager", "supervisor"];
const isManager = (role) => MANAGER_ROLES.includes(role);
const DOC_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

async function staffOr401(req, res) {
  let user = null;
  try { user = await assistantStaff(req); } catch (e) { user = null; }
  if (!user) res.status(401).json({ error: "سجّل دخولك الأول." });
  return user;
}

/**
 * linkSyncReview (managers): attach a booking waiting in sync_review to the CRM client the
 * manager picked. Same writes as a normal ingest update (money, status, 2-week follow-up,
 * integrationEvents audit) plus the review marked resolved and an activity log, in ONE
 * transaction. Idempotent: linking again to the same client changes nothing.
 * Body: { action: "linkSyncReview", bookingId, clientId }
 * 200 { success: true, clientId, changedFields, alreadyLinked? } | 400 | 401 | 403 | 404 | 409
 */
async function handleLinkSyncReview(req, res) {
  const user = await staffOr401(req, res);
  if (!user) return;
  if (!isManager(user.role)) return res.status(403).json({ error: "الربط للمديرين بس." });
  const bookingId = String(req.body?.bookingId || "").trim();
  const clientId = String(req.body?.clientId || "").trim();
  if (!DOC_ID_RE.test(bookingId) || !DOC_ID_RE.test(clientId)) return res.status(400).json({ error: "Invalid bookingId or clientId" });
  await loadAutoFollowUp();
  const reviewRef = db.collection("sync_review").doc(bookingId);
  const clientRef = db.collection("clients").doc(clientId);
  const now = Date.now();
  const out = await db.runTransaction(async (tx) => {
    const [reviewSnap, clientSnap] = await Promise.all([tx.get(reviewRef), tx.get(clientRef)]);
    if (!reviewSnap.exists) return { status: 404, error: "الحجز ده مش في قايمة المراجعة." };
    if (!clientSnap.exists) return { status: 404, error: "العميل مش موجود." };
    const reviewData = reviewSnap.data() || {};
    const summary = reviewData.summary;
    if (!summary || typeof summary !== "object" || summary.id !== bookingId) return { status: 409, error: "بيانات الحجز في المراجعة ناقصة." };
    if (reviewData.resolved === true && reviewData.resolvedClientId) {
      if (reviewData.resolvedClientId === clientId) return { success: true, clientId, changedFields: [], alreadyLinked: true };
      return { status: 409, error: "الحجز ده اتربط بعميل تاني قبل كده." };
    }
    const current = clientSnap.data() || {};
    const stale = accountingIngest.isStaleSummary(current, summary);
    let changedFields = [];
    if (!stale) {
      const { plan, auto, update } = planSummaryWrite(current, summary, { now, bookingId });
      changedFields = plan.changedFields;
      tx.update(clientRef, update);
      if (auto) tx.set(db.collection("logs").doc(), autoFollowUpLog(auto, clientId, current.name, now));
      tx.set(accountingAuditRef(bookingId), accountingAuditFields(bookingId, summary, now, {
        targetRef: clientId, result: "linked_from_review", via: "linkSyncReview", processedBy: user.uid,
        changedFields: plan.changedFields, overwroteFinancials: plan.overwroteFinancials,
        autoFollowUp: auto ? (auto.autoFollowUp.enabled ? "enabled" : "disabled") : null,
      }), { merge: true });
    }
    tx.set(reviewRef, { resolved: true, resolvedClientId: clientId, resolvedBy: user.uid, resolvedAt: now }, { merge: true });
    tx.set(db.collection("logs").doc(), {
      userId: user.uid, userName: user.name || "", action: `ربط حجز من الحسابات بعميل (مراجعة): ${bookingId}`,
      targetId: clientId, targetName: current.name || "", timestamp: now,
    });
    return { success: true, clientId, changedFields };
  });
  if (out.status) return res.status(out.status).json({ error: out.error });
  return res.json(out);
}

/**
 * integrationHealth (leaders): small numbers for an "is the sync alive" card. Count
 * aggregations and limit(1) reads only. A query whose index is still building returns null.
 * Body: { action: "integrationHealth" }
 * 200 { openSyncReview, failedAutomation24h, lastIngestAt, lastAutomationAt, errors? }
 */
async function handleIntegrationHealth(req, res) {
  const user = await staffOr401(req, res);
  if (!user) return;
  if (!crmAssistant.isLeader(user.role)) return res.status(403).json({ error: "للقيادات بس." });
  const since = Date.now() - 24 * 3600 * 1000;
  const errors = {};
  const safe = (name, p) => p.catch((e) => { errors[name] = String(e?.code || e?.message || e).slice(0, 120); return null; });
  const autoRuns = db.collection("automation_processed_conversations");
  const [openReview, failed, lastIngest, lastAutomation] = await Promise.all([
    safe("openSyncReview", db.collection("sync_review").where("resolved", "==", false).count().get()),
    safe("failedAutomation24h", autoRuns.where("status", "==", "failed").where("updatedAt", ">=", since).orderBy("updatedAt", "desc").count().get()),
    safe("lastIngestAt", db.collection("integrationEvents").where("sourceSystem", "==", "accounting").orderBy("processedAt", "desc").limit(1).get()),
    safe("lastAutomationAt", autoRuns.where("status", "==", "processed").orderBy("updatedAt", "desc").limit(1).get()),
  ]);
  return res.json({
    openSyncReview: openReview ? openReview.data().count : null,
    failedAutomation24h: failed ? failed.data().count : null,
    lastIngestAt: lastIngest ? (lastIngest.empty ? 0 : lastIngest.docs[0].data().processedAt || 0) : null,
    lastAutomationAt: lastAutomation ? (lastAutomation.empty ? 0 : lastAutomation.docs[0].data().updatedAt || 0) : null,
    ...(Object.keys(errors).length ? { errors } : {}),
  });
}

/**
 * phoneCheck (any active staff): "is this phone already a client?" for the add-client screen,
 * now that sales cannot read every client. Returns the oldest client with that phoneKey (then
 * phoneKeys, then the old raw-phone variations for legacy docs).
 * Body: { action: "phoneCheck", phone, countryCode? }
 * 200 { exists: false } | { exists: true, client: { id, name, salesAgentName, status, createdAt, mine } } | 400 | 401
 */
async function handlePhoneCheck(req, res) {
  const user = await staffOr401(req, res);
  if (!user) return;
  const phone = req.body?.phone;
  const countryCode = req.body?.countryCode;
  if ((typeof phone !== "string" && typeof phone !== "number") || String(phone).length > 32) return res.status(400).json({ error: "Invalid phone" });
  if (countryCode !== undefined && countryCode !== null && countryCode !== "" && (typeof countryCode !== "string" || !/^\+?\d{1,4}$/.test(countryCode.trim()))) {
    return res.status(400).json({ error: "Invalid countryCode" });
  }
  const cc = countryCode ? (countryCode.trim().startsWith("+") ? countryCode.trim() : `+${countryCode.trim()}`) : "+20";
  const phoneFull = normalizeIncomingPhone(phone, cc);
  const key = phoneFull ? accountingIngest.normalizePhoneKey(phoneFull) : "";
  if (!key) return res.status(400).json({ error: "Invalid phone" });
  const clients = db.collection("clients");
  const asDocs = (snap) => snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
  let docs = asDocs(await clients.where("phoneKey", "==", key).limit(5).get());
  if (!docs.length) docs = asDocs(await clients.where("phoneKeys", "array-contains", key).limit(5).get());
  if (!docs.length) docs = asDocs(await clients.where("phone", "in", buildPhoneVariations(phoneFull)).limit(5).get());
  const match = automationUpsert.pickDedupeMatch(docs);
  if (!match) return res.json({ exists: false });
  const c = match.pick.data;
  return res.json({
    exists: true,
    client: {
      id: match.pick.id, name: c.name || "", salesAgentName: c.salesAgentName || "", status: c.status || "",
      createdAt: typeof c.createdAt === "number" ? c.createdAt : (c.createdAt?.toMillis?.() ?? null),
      mine: !!c.salesAgentId && c.salesAgentId === user.uid,
    },
  });
}

const STAFF_BRIDGE_ACTIONS = { linkSyncReview: handleLinkSyncReview, integrationHealth: handleIntegrationHealth, phoneCheck: handlePhoneCheck };

exports.accountingCrmBridge = onRequest({ region: "us-central1", cors: true, secrets: [ANTHROPIC_API_KEY_CRM], timeoutSeconds: 120, maxInstances: 10 }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const action = req.body?.action;
  if (!["lookup", "syncBooking", "ingest", "export", "assistant", "clientSnapshot", ...Object.keys(STAFF_BRIDGE_ACTIONS)].includes(action)) return res.status(400).json({ error: "Invalid action" });
  if (action === "assistant") return handleAssistant(req, res);
  if (action === "clientSnapshot") return handleClientSnapshot(req, res);
  if (STAFF_BRIDGE_ACTIONS[action]) {
    try { return await STAFF_BRIDGE_ACTIONS[action](req, res); }
    catch (error) { console.error(`bridge ${action} failed:`, error?.message || error); return res.status(500).json({ error: "حصلت مشكلة. جرّب تاني بعد شوية." }); }
  }
  if (action === "export") {
    try { return await handleCrmExport(req, res); }
    catch (error) { console.error("crm export failed:", error); return res.status(500).json({ error: "Export failed" }); }
  }
  if (action === "ingest") {
    try { return await handleAccountingIngest(req, res); }
    catch (error) { console.error("accounting ingest failed:", error); return res.status(500).json({ error: "Ingest failed" }); }
  }

  try {
    const actor = await authorizedAccountingUser(req, action === "syncBooking");
    if (!actor) return res.status(403).json({ error: "Accounting access denied" });

    if (action === "lookup") {
      const phone = String(req.body?.phone || "").trim();
      if (!phone || phone.length > 32) return res.status(400).json({ error: "Invalid phone" });
      const match = await findClientForAccounting(phone, req.body?.countryCode || "+20");
      if (match?.ambiguous) return res.json({ found: false, ambiguous: true });
      if (!match) return res.json({ found: false });
      return res.json({ found: true, client: {
        id: match.id, name: match.data.name || "", status: match.data.status || "",
        serviceName: match.data.serviceName || "", isBooked: !!match.data.isBooked,
        salesAgentName: match.data.salesAgentName || "",
        lastFollowUpDate: match.data.lastFollowUpDate || null,
      } });
    }

    const bookingId = String(req.body?.bookingId || "").trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(bookingId)) return res.status(400).json({ error: "Invalid booking ID" });
    const booking = await accountingDocument(`bookings/${bookingId}`, actor.token);
    if (!booking || booking.status !== "ACTIVE" || booking.isDeleted || !booking.customerId) {
      return res.status(409).json({ error: "Booking is not active" });
    }
    const customer = await accountingDocument(`customers/${encodeURIComponent(booking.customerId)}`, actor.token);
    if (!customer || customer.isDeleted) return res.status(409).json({ error: "Customer not found" });
    const match = await findClientForAccounting(customer.fullWhatsapp || customer.whatsapp, customer.countryCode || "+20");
    if (match?.ambiguous) return res.status(409).json({ error: "Multiple CRM clients match this phone" });
    if (!match) return res.json({ success: true, action: "no_match" });

    const productCollection = booking.productType === "diploma" ? "diplomas" : "courses";
    const product = booking.productId
      ? await accountingDocument(`${productCollection}/${encodeURIComponent(booking.productId)}`, actor.token)
      : null;
    const now = Date.now();
    await loadAutoFollowUp();
    const auditRef = db.collection("integrationEvents").doc(`accounting_booking_${bookingId}`);
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(db.collection("clients").doc(match.id));
      const current = snapshot.data() || {};
      if (current.accountingBookingIds?.includes(bookingId)) return { action: "already_synced" };
      const plan = planAccountingBookingSync(current, booking, product?.name);
      const auto = plan.isLatestBooking
        ? autoFollowUp.planAccountingAutoFollowUp(current, plan.applied, { now, bookingId }, admin.firestore.FieldValue.delete())
        : null;
      transaction.update(snapshot.ref, {
        accountingBookingIds: admin.firestore.FieldValue.arrayUnion(bookingId),
        accountingLastSyncedAt: now,
        ...(plan.isLatestBooking ? plan.applied : {}),
        ...(auto || {}),
      });
      if (auto) transaction.set(db.collection("logs").doc(), autoFollowUpLog(auto, snapshot.id, current.name, now));
      transaction.set(auditRef, {
        correlationId: `accounting_booking_${bookingId}`,
        sourceSystem: "accounting",
        targetSystem: "crm",
        eventType: "booking_confirmed",
        status: plan.isLatestBooking ? "completed" : "linked_older_booking",
        sourceRef: bookingId,
        targetRef: snapshot.id,
        changedFields: plan.changedFields,
        overwrittenFinancialFields: plan.overwrittenFinancialFields,
        previous: plan.previous,
        incoming: plan.applied,
        processedAt: now,
        processedBy: actor.uid,
      });
      const log = db.collection("logs").doc();
      transaction.set(log, { userId: actor.uid, userName: actor.email, action: `تأكيد حجز من الحسابات: ${bookingId}`,
        targetId: snapshot.id, targetName: current.name || "", timestamp: now });
      return {
        action: plan.isLatestBooking ? "updated" : "linked_older_booking",
        overwroteFinancials: plan.overwrittenFinancialFields.length > 0,
      };
    });
    return res.json({ success: true, ...result, clientId: match.id });
  } catch (error) {
    if (error instanceof RangeError) return res.status(409).json({ error: error.message });
    console.error("accountingCrmBridge failed:", error);
    return res.status(500).json({ error: "CRM integration unavailable" });
  }
});

function parseAutomationTimestamp(...candidates) {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") continue;

    if (typeof candidate === "number") {
      const ts = candidate < 10000000000 ? candidate * 1000 : candidate;
      if (Number.isFinite(ts) && ts > 0) return ts;
    }

    const raw = String(candidate).trim();
    if (!raw) continue;

    if (/^\d+$/.test(raw)) {
      const numeric = Number(raw);
      const ts = numeric < 10000000000 ? numeric * 1000 : numeric;
      if (Number.isFinite(ts) && ts > 0) return ts;
    }

    const parsed = new Date(raw).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function getAutomationConversationRef(body) {
  const rawId = body.chatwoot_conversation_id || body.conversation_id;
  if (!rawId) return null;
  const conversationId = String(rawId);
  const safeId = `chatwoot_${conversationId.replace(/\//g, "_")}`;
  return {
    conversationId,
    ref: db.collection("automation_processed_conversations").doc(safeId),
  };
}

async function claimAutomationConversation(body, startedAt) {
  const info = getAutomationConversationRef(body);
  if (!info) return null;

  const incomingLastChatwootContactAt = parseAutomationTimestamp(
    body.last_contact_at,
    body.last_followup_date,
    body.last_followup_at,
    body.last_contacted_at,
    body.last_message_at,
    body.chatwoot_last_activity_at
  );

  const existing = await info.ref.get();
  if (existing.exists) {
    const data = existing.data() || {};
    if (data.status !== "failed") {
      const previousLastChatwootContactAt = data.lastChatwootContactAt || 0;
      const hasNewerChatwootContact =
        incomingLastChatwootContactAt &&
        incomingLastChatwootContactAt > previousLastChatwootContactAt;

      if (!hasNewerChatwootContact) {
        return {
          alreadyProcessed: true,
          conversationId: info.conversationId,
          clientId: data.clientId || null,
          action: data.action || null,
        };
      }

      console.log("upsertClientFromAutomation: reprocessing conversation with newer Chatwoot contact", {
        conversationId: info.conversationId,
        previousLastChatwootContactAt,
        incomingLastChatwootContactAt,
      });
    }
  }

  await info.ref.set({
    source: "chatwoot",
    chatwootConversationId: info.conversationId,
    status: "processing",
    runMode: body.automation_mode || body.run_mode || "hourly",
    startedAt,
    updatedAt: startedAt,
    ...(incomingLastChatwootContactAt ? { lastChatwootContactAt: incomingLastChatwootContactAt } : {}),
  }, { merge: true });

  return {
    alreadyProcessed: false,
    conversationId: info.conversationId,
    ref: info.ref,
  };
}

function cleanDistinctiveSearchPhrase(value) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, 280);
}

function cleanAutomationText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasBetterAutomationName(body, existingClient) {
  const incomingName = body.customer_name && String(body.customer_name).trim();
  if (!incomingName || PLACEHOLDER_NAME_RE.test(incomingName)) return false;
  const existingName = existingClient?.name && String(existingClient.name).trim();
  return !existingName || PLACEHOLDER_NAME_RE.test(existingName);
}

function shouldReprocessSameConversation(body, existingClient, lastChatwootContactAt, hasExplicitNextFollowUp, phoneFull) {
  if (!existingClient) return true;

  const hasNewerChatwootContact =
    lastChatwootContactAt &&
    lastChatwootContactAt > (existingClient.lastChatwootContactAt || 0);
  const canAddMissingPhone = phoneFull && !existingClient.phone;
  const canAddMissingName = hasBetterAutomationName(body, existingClient);

  return Boolean(hasNewerChatwootContact || canAddMissingPhone || canAddMissingName || hasExplicitNextFollowUp);
}

function calculateFollowUpDelayStatus(startTime, scheduledTime) {
  if (!scheduledTime || scheduledTime <= 0) return "on_time";
  const delayMins = (startTime - scheduledTime) / (1000 * 60);
  if (delayMins > 15) return "large_delay";
  if (delayMins > 5) return "acceptable";
  return "on_time";
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

// A governorate / city name from the automation: short plain text, '' when unknown.
function automationPlace(value) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text || text.length > 60 || /^(unknown|unspecified|null|none|n\/a|غير معروف|غير محدد|لم يحدد|لم يذكر)$/i.test(text)) return "";
  return text;
}

// Accounting's salesName / n8n's sales_rep_name -> CRM user (see agentMatch.js). null = no
// confident match; the caller then uses the default automation agent.
async function findAgentByName(rawName) {
  if (!rawName || !String(rawName).trim()) return null;
  try {
    const [users, aliases] = await Promise.all([
      cachedUsers(),
      cachedSalesAliases().catch((e) => { console.warn("sales aliases unavailable:", e?.message || e); return new Map(); }),
    ]);
    return agentMatch.matchAgent(users, rawName, aliases);
  } catch (e) {
    console.error("findAgentByName lookup failed:", e);
    return null;
  }
}

async function matchLabelIds(suggestedLabels) {
  if (!Array.isArray(suggestedLabels) || suggestedLabels.length === 0) return [];
  try {
    return automationUpsert.matchLabelIdsFrom(await cachedLabels(), suggestedLabels);
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

// Lead for Meta from a new automation client. content_name is generic on purpose: the client's
// name never goes to Meta in clear (the phone goes only as a SHA-256 hash).
async function postMetaLeadEvent(phoneFull, contentCategory) {
  const metaPixelId = process.env.META_PIXEL_ID || "";
  const metaAccessToken = process.env.META_ACCESS_TOKEN || "";
  if (!metaPixelId || !metaAccessToken) return;
  try {
    const eventData = {
      event_name: "Lead",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "system_generated",
      user_data: { ph: [hashForMeta(phoneFull.replace(/\D/g, ""))] },
      custom_data: { content_name: "crm_automation_lead", content_category: contentCategory || "automation" },
    };
    await fetch(`https://graph.facebook.com/v21.0/${metaPixelId}/events?access_token=${encodeURIComponent(metaAccessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [eventData] }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("postMetaLeadEvent failed (non-fatal):", e?.message || e);
  }
}

/**
 * Read-only lookup for the n8n automation: the live, active services catalog,
 * so the Gemini extraction step can semantically match a customer's own wording
 * against the real course list instead of a hardcoded name list baked into the prompt.
 */
exports.getActiveServicesForAutomation = onRequest({ region: "us-central1", cors: true, maxInstances: 5 }, async (req, res) => {
  if (!automationKeyOk(req.get("x-automation-secret"))) {
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


/*
 * upsertClientFromAutomation: called by the n8n idle-conversation workflow (Chatwoot -> Claude
 * extraction -> here). Full contract with examples: docs/automation-contract.md.
 *
 * Auth: header "x-automation-secret" only (checked by SHA-256 in automationKey.js). A key in the
 * JSON body is no longer accepted.
 *
 * Request body (JSON object; every field optional unless stated; longer text is cut to the limit,
 * a wrong type or an absurd payload (>100k chars, any text >20k, any list >100 items) -> 400):
 *   customer_phone            string|number  <=32   needed unless a chatwoot_contact_id is given (non-WhatsApp)
 *   country_code              string         <=6    "+20" style; default "+20"
 *   customer_name             string         <=120  placeholders ("unknown", ...) are ignored
 *   position, suggested_service, sales_rep_name     string <=120
 *   governorate, city         string         <=60   only stored when the client has none
 *   sales_brief, detailed_result                    string <=2000
 *   suggested_status          string         interested | potential | not_interested | booked
 *   suggested_labels          string[]       <=20 items of <=60
 *   next_followup_date        string|number  ISO date/time or unix s/ms
 *   next_followup_channel     string         phone | whatsapp | meeting | other
 *   next_followup_reason      string         <=500
 *   missing_or_ambiguous_fields string[]     <=20 items of <=80; "next_followup_date_suggested_not_explicit"
 *                                            marks the date as the AI's suggestion
 *   distinctive_search_phrase (or search_phrase / meta_search_phrase) string <=280
 *   has_meaningful_content    boolean        false -> skipped
 *   source                    string         whatsapp | messenger | facebook | instagram | tiktok | google | other
 *   gender                    string         male | female | unspecified
 *   has_laptop                string         with | without | unspecified
 *   attendance_mode           string         online | offline | unspecified
 *   profile_link, chatwoot_conversation_link        string <=500
 *   chatwoot_conversation_id (or conversation_id), chatwoot_contact_id   string|number <=64
 *   last_contact_at (or last_followup_date / last_followup_at / last_contacted_at / last_message_at /
 *     chatwoot_last_activity_at)                    string|number  time of the last message
 *   automation_mode / run_mode string <=40
 *   ad_code                   string <=20    NEW. 1-3 letters + 1-4 digits (e.g. N12), uppercased; else ignored
 *   first_message_at          string|number  NEW. time of the customer's first message
 *
 * Rules: never sets booked or money; booked / not_interested / interested are never changed
 * (no downgrade); only an explicit FUTURE next_followup_date sets nextFollowUpDate (flagged
 * nextFollowUpReviewedBySales:false for the agent's Accept); a suggested or past date is kept
 * as automationSuggestedFollowUp only. Dedupe by phoneKey (then phoneKeys, then the old phone
 * variations for legacy docs); with several matches the oldest client is used and the claim
 * records it. adCode / firstMessageAt are first-touch: stored only when the client has none.
 *
 * Response: { success, action: "created_new" | "updated_existing" | "skipped", clientId?, reason?,
 *             bookedMentioned? }   | 400 { error } | 401 | 405 | 500 { error }
 */
exports.upsertClientFromAutomation = onRequest({ region: "us-central1", cors: true, maxInstances: 10 }, async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!automationKeyOk(req.get("x-automation-secret"))) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const invalid = automationUpsert.validateAutomationBody(req.body);
  if (invalid) {
    return res.status(400).json({ error: `Invalid payload: ${invalid}` });
  }

  const body = automationUpsert.sanitizeAutomationBody(req.body);
  const automationNow = Date.now();
  let processingClaim = null;

  try {
    processingClaim = await claimAutomationConversation(body, automationNow);
    if (processingClaim?.alreadyProcessed) {
      return res.json({
        success: true,
        action: "skipped",
        reason: "conversation_already_processed",
        clientId: processingClaim.clientId,
        previousAction: processingClaim.action,
      });
    }
  } catch (error) {
    console.error("upsertClientFromAutomation claim failed:", error);
    return res.status(500).json({ error: "Could not claim automation conversation" });
  }

  const markClaim = async (fields) => {
    if (!processingClaim?.ref) return;
    await processingClaim.ref.set({ ...fields, completedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
  };

  if (body.has_meaningful_content === false) {
    await markClaim({ status: "skipped", reason: "not_meaningful", action: "skipped" });
    return res.json({ success: true, action: "skipped", reason: "not_meaningful" });
  }

  const phoneFull = normalizeIncomingPhone(body.customer_phone, body.country_code || "+20");
  const phoneKey = phoneFull ? accountingIngest.normalizePhoneKey(phoneFull) : "";
  const mappedSource = mapSource(body.source);
  const hasChatwootContactId = !!body.chatwoot_contact_id;
  if (!phoneFull && (mappedSource === "whatsapp" || !hasChatwootContactId)) {
    console.log("upsertClientFromAutomation: skipped, no valid phone. conversation:", body.chatwoot_conversation_id);
    await markClaim({ status: "skipped", reason: "no_phone", action: "skipped" });
    return res.json({
      success: true,
      action: "skipped",
      reason: "no_phone",
      note_for_agent: "تمت معالجة المحادثة تلقائيًا لكن بدون رقم هاتف واضح — تحتاج مراجعة يدوية.",
    });
  }

  const lastChatwootContactAt = parseAutomationTimestamp(
    body.last_contact_at,
    body.last_followup_date,
    body.last_followup_at,
    body.last_contacted_at,
    body.last_message_at,
    body.chatwoot_last_activity_at
  );
  const mappedMethod = mapMethod(body.next_followup_channel);
  const datePlan = automationUpsert.planAutomationFollowUpDate({ body, method: mappedMethod, now: automationNow });
  const adCode = automationUpsert.parseAdCode(body.ad_code);
  const firstMessageAt = automationUpsert.parseTimestamp(body.first_message_at, automationNow);
  const followUpStartTime = lastChatwootContactAt || automationNow;
  const followUpDurationSeconds = 5 * 60;
  const followUpEndTime = followUpStartTime + (followUpDurationSeconds * 1000);
  const distinctiveSearchPhrase = cleanDistinctiveSearchPhrase(
    body.distinctive_search_phrase || body.search_phrase || body.meta_search_phrase
  );
  const automationSalesRepNameRaw = cleanAutomationText(body.sales_rep_name);
  const clients = db.collection("clients");
  const asDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ref: d.ref, data: d.data() || {} }));

  try {
    let match = null; // { pick: { id, ref, data }, ambiguous, candidateIds }
    if (body.chatwoot_conversation_id) {
      const sameConversation = await clients.where("chatId", "==", String(body.chatwoot_conversation_id)).limit(1).get();
      if (!sameConversation.empty) {
        const existingDoc = sameConversation.docs[0];
        const existingClient = existingDoc.data() || {};
        if (!shouldReprocessSameConversation(body, existingClient, lastChatwootContactAt, datePlan.explicitFuture, phoneFull)) {
          await markClaim({
            status: "skipped", reason: "conversation_already_processed", action: "skipped", clientId: existingDoc.id,
            ...(lastChatwootContactAt ? { lastChatwootContactAt } : {}),
          });
          return res.json({ success: true, action: "skipped", reason: "conversation_already_processed", clientId: existingDoc.id });
        }
        match = { pick: { id: existingDoc.id, ref: existingDoc.ref, data: existingClient }, ambiguous: false, candidateIds: [existingDoc.id] };
      }
    }

    if (!match && phoneKey) {
      // phoneKey first (one equality query), then the other numbers a client has (phoneKeys),
      // then the old raw-phone variations for legacy docs written before phoneKey existed.
      let docs = asDocs(await clients.where("phoneKey", "==", phoneKey).limit(5).get());
      if (!docs.length) docs = asDocs(await clients.where("phoneKeys", "array-contains", phoneKey).limit(5).get());
      if (!docs.length) docs = asDocs(await clients.where("phone", "in", buildPhoneVariations(phoneFull)).limit(5).get());
      match = automationUpsert.pickDedupeMatch(docs);
    }
    if (!match && hasChatwootContactId) {
      match = automationUpsert.pickDedupeMatch(asDocs(await clients.where("chatwootContactId", "==", String(body.chatwoot_contact_id)).limit(5).get()));
    }
    if (match?.ambiguous) {
      console.warn("upsertClientFromAutomation: several clients match, using the oldest", { picked: match.pick.id, candidates: match.candidateIds.length });
    }
    const dedupeInfo = match?.ambiguous ? { dedupe: { ambiguous: true, pickedClientId: match.pick.id, candidateIds: match.candidateIds.slice(0, 10) } } : {};

    const defaultAgent = await getDefaultAutomationAgent();
    const requestedAgent = body.sales_rep_name ? await findAgentByName(body.sales_rep_name) : null;
    const resolvedAgent = requestedAgent || defaultAgent;
    const matchedLabelIds = await matchLabelIds(body.suggested_labels);

    if (match) {
      // ----- Existing client: log a follow-up, apply conservative updates -----
      const existingDoc = match.pick;
      const existingClient = existingDoc.data;
      const { status: nextStatus, bookedMentioned } = automationUpsert.decideAutomationStatus(existingClient, body.suggested_status);
      const batch = db.batch();

      const updateData = {
        lastFollowUpDate: followUpStartTime,
      };

      if (nextStatus) updateData.status = nextStatus;
      if (matchedLabelIds.length > 0) {
        updateData.labels = Array.from(new Set([...(existingClient.labels || []), ...matchedLabelIds]));
      }
      if (datePlan.set) Object.assign(updateData, datePlan.set);
      else if (datePlan.suggestion) Object.assign(updateData, datePlan.suggestion);

      if (phoneFull && !existingClient.phone) {
        updateData.phone = phoneFull;
        updateData.phoneKey = phoneKey;
        updateData.phoneKeys = phoneKey ? [phoneKey] : [];
        updateData.countryCode = body.country_code || existingClient.countryCode || "+20";
      } else {
        Object.assign(updateData, automationUpsert.phoneKeyBackfill(existingClient, accountingIngest.normalizePhoneKey(existingClient.phone) || phoneKey));
      }
      if (hasChatwootContactId && !existingClient.chatwootContactId) {
        updateData.chatwootContactId = String(body.chatwoot_contact_id);
      }
      if (hasBetterAutomationName(body, existingClient)) {
        updateData.name = String(body.customer_name).trim();
      }
      if (!existingClient.position && body.position) {
        updateData.position = body.position;
      }
      // Where the client lives: only filled when the CRM has nothing yet, never overwritten.
      if (!existingClient.governorate && automationPlace(body.governorate)) updateData.governorate = automationPlace(body.governorate);
      if (!existingClient.city && automationPlace(body.city)) updateData.city = automationPlace(body.city);
      if (!existingClient.chatId && body.chatwoot_conversation_id) {
        updateData.chatId = String(body.chatwoot_conversation_id);
      }
      if (!existingClient.profileLink && body.profile_link) {
        updateData.profileLink = body.profile_link;
      }
      if (lastChatwootContactAt && lastChatwootContactAt > (existingClient.lastChatwootContactAt || 0)) {
        updateData.lastChatwootContactAt = lastChatwootContactAt;
      }
      if (distinctiveSearchPhrase && (!existingClient.distinctiveSearchPhrase || lastChatwootContactAt > (existingClient.lastChatwootContactAt || 0))) {
        updateData.distinctiveSearchPhrase = distinctiveSearchPhrase;
      }
      if (automationSalesRepNameRaw) {
        updateData.automationSalesRepNameRaw = automationSalesRepNameRaw;
      }
      Object.assign(updateData, automationUpsert.firstTouchFields(existingClient, { adCode, firstMessageAt }));

      if (updateData.name || updateData.phone) {
        const { buildSearchKeys } = await import("./searchKeys.mjs");
        updateData.searchKeys = buildSearchKeys(updateData.name || existingClient.name, updateData.phone || existingClient.phone);
      }
      batch.update(existingDoc.ref, updateData);

      const followUpRef = db.collection("followups").doc();
      const scheduledTime = existingClient.nextFollowUpDate || 0;
      batch.set(followUpRef, {
        clientId: existingDoc.id,
        clientName: updateData.name || existingClient.name || "عميل",
        agentId: resolvedAgent.id,
        agentName: `${resolvedAgent.name} (تحليل تلقائي)`,
        // The client's owner when this was written (read rules let that agent see it).
        clientAgentId: existingClient.salesAgentId || "",
        note: body.detailed_result || body.sales_brief || "تحليل تلقائي لمحادثة غير نشطة",
        result: bookedMentioned ? "العميل ذكر رغبته في الحجز - يحتاج تأكيد ودفع من موظف" : "متابعة تلقائية من تحليل المحادثة",
        salesBrief: body.sales_brief || "",
        method: mappedMethod,
        timestamp: automationNow,
        startTime: followUpStartTime,
        endTime: followUpEndTime,
        duration: followUpDurationSeconds,
        scheduledTime,
        delayStatus: calculateFollowUpDelayStatus(followUpStartTime, scheduledTime),
        appointmentId: null,
        isAutomated: true,
        automationSalesRepNameRaw,
        adCode: automationUpsert.followUpAdCode(existingClient, adCode),
        chatwootConversationId: body.chatwoot_conversation_id ? String(body.chatwoot_conversation_id) : null,
      });

      const logRef = db.collection("logs").doc();
      batch.set(logRef, {
        userId: resolvedAgent.id,
        userName: `${resolvedAgent.name} (تحليل تلقائي)`,
        action: `تسجيل متابعة خارجية تلقائية: ${(body.sales_brief || "محادثة Chatwoot").slice(0, 300)}`,
        targetId: existingDoc.id,
        targetName: updateData.name || existingClient.name || "عميل",
        timestamp: automationNow,
      });

      if (processingClaim?.ref) {
        batch.set(processingClaim.ref, {
          status: "processed",
          action: "updated_existing",
          clientId: existingDoc.id,
          followUpId: followUpRef.id,
          bookedMentioned,
          ...(datePlan.suggestion ? { followUpDateKeptAsSuggestion: datePlan.suggestion.automationSuggestedFollowUp.reason } : {}),
          ...dedupeInfo,
          completedAt: automationNow,
          updatedAt: automationNow,
          ...(lastChatwootContactAt ? { lastChatwootContactAt } : {}),
        }, { merge: true });
      }

      await batch.commit();
      return res.json({ success: true, action: "updated_existing", clientId: existingDoc.id, bookedMentioned });
    }

    // ----- New client -----
    const { status: newStatus, bookedMentioned } = automationUpsert.decideAutomationStatus(null, body.suggested_status);
    const serviceMatch = await matchService(body.suggested_service);
    const cleanName =
      body.customer_name && !PLACEHOLDER_NAME_RE.test(body.customer_name)
        ? body.customer_name
        : "عميل تلقائي (بانتظار المراجعة)";

    const newClientRef = clients.doc();
    const newClientData = {
      name: cleanName,
      position: body.position || "",
      phone: phoneFull || "",
      phoneKey,
      phoneKeys: phoneKey ? [phoneKey] : [],
      chatwootContactId: body.chatwoot_contact_id ? String(body.chatwoot_contact_id) : null,
      chatId: body.chatwoot_conversation_id ? String(body.chatwoot_conversation_id) : null,
      gender: ["male", "female", "unspecified"].includes(body.gender) ? body.gender : "unspecified",
      laptop: ["with", "without", "unspecified"].includes(body.has_laptop) ? body.has_laptop : "unspecified",
      mode: ["online", "offline", "unspecified"].includes(body.attendance_mode) ? body.attendance_mode : "unspecified",
      status: newStatus,
      serviceId: serviceMatch.serviceId,
      serviceName: serviceMatch.serviceName,
      labels: matchedLabelIds,
      salesAgentId: resolvedAgent.id,
      salesAgentName: resolvedAgent.name,
      createdAt: automationNow,
      lastFollowUpDate: followUpStartTime,
      country: "مصر",
      countryCode: body.country_code || "+20",
      governorate: automationPlace(body.governorate),
      city: automationPlace(body.city),
      source: mappedSource,
      profileLink: body.profile_link || "",
      distinctiveSearchPhrase,
      automationSalesRepNameRaw,
      preferredMethod: mappedMethod,
      lastChatwootContactAt: lastChatwootContactAt || null,
      createdVia: "ai_automation",
      reviewedBySales: false,
      notes: [
        "🤖 تم إنشاء هذا العميل تلقائيًا من تحليل محادثة غير نشطة (Chatwoot).",
        body.sales_brief ? `الملخص: ${body.sales_brief}` : "",
        Array.isArray(body.missing_or_ambiguous_fields) && body.missing_or_ambiguous_fields.length
          ? `بيانات ناقصة/غير واضحة: ${body.missing_or_ambiguous_fields.join("، ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      nextFollowUpDate: 0, // "no date yet" (queryable; a missing field is not)
      ...(datePlan.set || datePlan.suggestion || {}),
      ...automationUpsert.firstTouchFields(null, { adCode, firstMessageAt }),
    };

    const batch = db.batch();
    newClientData.searchKeys = (await import("./searchKeys.mjs")).buildSearchKeys(newClientData.name, newClientData.phone);
    batch.set(newClientRef, newClientData);

    const followUpRef = db.collection("followups").doc();
    batch.set(followUpRef, {
      clientId: newClientRef.id,
      clientName: cleanName,
      agentId: resolvedAgent.id,
      agentName: `${resolvedAgent.name} (تحليل تلقائي)`,
      clientAgentId: resolvedAgent.id,
      note: body.detailed_result || body.sales_brief || "عميل جديد تم رصده تلقائيًا",
      result: bookedMentioned ? "العميل ذكر رغبته في الحجز - يحتاج تأكيد ودفع من موظف" : "عميل جديد من تحليل تلقائي",
      salesBrief: body.sales_brief || "",
      method: mappedMethod,
      timestamp: automationNow,
      startTime: followUpStartTime,
      endTime: followUpEndTime,
      duration: followUpDurationSeconds,
      scheduledTime: 0,
      delayStatus: "on_time",
      appointmentId: null,
      isAutomated: true,
      automationSalesRepNameRaw,
      adCode: adCode || null,
      chatwootConversationId: body.chatwoot_conversation_id ? String(body.chatwoot_conversation_id) : null,
    });

    const logRef = db.collection("logs").doc();
    batch.set(logRef, {
      userId: resolvedAgent.id,
      userName: `${resolvedAgent.name} (تحليل تلقائي)`,
      action: `إضافة عميل جديد تلقائيًا (${mappedSource}): ${cleanName}`,
      targetId: newClientRef.id,
      targetName: cleanName,
      timestamp: automationNow,
    });

    if (processingClaim?.ref) {
      batch.set(processingClaim.ref, {
        status: "processed",
        action: "created_new",
        clientId: newClientRef.id,
        followUpId: followUpRef.id,
        bookedMentioned,
        ...(datePlan.suggestion ? { followUpDateKeptAsSuggestion: datePlan.suggestion.automationSuggestedFollowUp.reason } : {}),
        completedAt: automationNow,
        updatedAt: automationNow,
        ...(lastChatwootContactAt ? { lastChatwootContactAt } : {}),
      }, { merge: true });
    }

    await batch.commit();
    if (phoneFull) {
      await postMetaLeadEvent(phoneFull, mappedSource);
    }

    return res.json({ success: true, action: "created_new", clientId: newClientRef.id, bookedMentioned });
  } catch (error) {
    console.error("upsertClientFromAutomation error:", error);
    if (processingClaim?.ref) {
      await processingClaim.ref.set({
        status: "failed",
        error: String(error?.message || "Unknown error in upsertClientFromAutomation").slice(0, 500),
        updatedAt: Date.now(),
      }, { merge: true }).catch((markerError) => {
        console.error("upsertClientFromAutomation failed marker update failed:", markerError);
      });
    }
    return res.status(500).json({ error: "Unknown error in upsertClientFromAutomation" });
  }
});
