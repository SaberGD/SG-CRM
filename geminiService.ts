import { Client, FollowUp, DailyReport } from "./types";

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
