import { Client, FollowUp, DailyReport, ClientStatus } from "./types";

/**
 * Predicts sales opportunity and analyzes lead history via Server API.
 */
export const predictSalesOpportunity = async (client: Client, followUps: FollowUp[]) => {
  try {
    const response = await fetch("/api/gemini/predict-sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client, followUps }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("predictSalesOpportunity error calling endpoint:", error);
    return { score: 'Medium', reason: 'حدث خطأ في الاتصال بالسيرفر للتحليل الذكي' };
  }
};

/**
 * Provides automated analysis for daily sales reports via Server API.
 */
export const analyzeDailyReport = async (report: DailyReport) => {
  try {
    const response = await fetch("/api/gemini/analyze-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.text || "فشل تحليل التقرير بواسطة AI.";
  } catch (error) {
    console.error("analyzeDailyReport error calling endpoint:", error);
    return "فشل تحليل التقرير بسبب مشكلة في الاتصال بالسيرفر.";
  }
};

/**
 * Analyzes client history and generates AI sales assistant recommendation via Server API.
 */
export const analyzeClientWithAi = async (client: Client, followUps: FollowUp[] = []) => {
  try {
    const response = await fetch("/api/gemini/analyze-client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client, followUps }),
    });
    if (!response.ok) {
      console.warn(`analyzeClientWithAi HTTP status: ${response.status}`);
      // Return rule-based fallback response on server error
      const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      const courseName = client.bookedCourseName || client.serviceName || 'كورس الجرافيك ديزاين والـ AI';
      return {
        suggestedDate: tomorrowStr,
        suggestedTime: "15:00",
        suggestedChannel: "واتساب",
        suggestedPitch: `أهلاً بك يا ${client.name}! معك المساعد الذكي من أكاديمية صابر جروب (SABER GROUP) 🎨 نحب نذكرك بإن باب الحجز المبكر لكورس ${courseName} مفتوح حالياً بخصم مميز بالإضافة لكوبون خصم إضافي 400 جنيه متاح لمدة 24 ساعة فقط! لتأكيد الحجز تواصل معنا عبر واتساب الرسمي: 01040784390`,
        conversionPriority: (client.status as string) === 'interested' || (client.status as string) === 'مهتم' || client.status === ClientStatus.INTERESTED ? 'عالي' : 'متوسط',
        insightsSummary: `تحليل صابر جروب الذكي: العميل (${client.name}) يظهر اهتماماً بـ (${courseName}). نوصي بالدخول مباشرة بالتفاصيل والتقسيط المريح.`,
        salesTip: "استخدم كوبون الـ 400 جنيه الإضافي لتشجيع العميل على التأكيد المباشر."
      };
    }
    return await response.json();
  } catch (error) {
    console.error("analyzeClientWithAi error calling endpoint:", error);
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const courseName = client.bookedCourseName || client.serviceName || 'كورس الجرافيك ديزاين';
    return {
      suggestedDate: tomorrowStr,
      suggestedTime: "15:00",
      suggestedChannel: "واتساب",
      suggestedPitch: `أهلاً بك يا ${client.name}! معك المساعد الذكي من أكاديمية صابر جروب 🎨 نود تذكيرك بعرض الحجز المبكر المتاح حالياً لكورس ${courseName} مع إمكانية التقسيط المريح بدون فوائد. لتأكيد حجزك تواصل معنا على واتساب: 01040784390`,
      conversionPriority: 'متوسط',
      insightsSummary: `توصية ذكية لمتابعة العميل ${client.name} وتقديم خيارات التقسيط المتاحة.`,
      salesTip: "ركز على إبراز التطبيق العملي وبورتفوليو خريجي الأكاديمية."
    };
  }
};
