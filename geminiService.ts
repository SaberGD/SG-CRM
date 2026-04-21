
// Always use correct imports from @google/genai
import { GoogleGenAI, Type } from "@google/genai";
import { Client, FollowUp, DailyReport } from "./types";

/**
 * Predicts sales opportunity and analyzes lead history using Gemini API.
 */
export const predictSalesOpportunity = async (client: Client, followUps: FollowUp[]) => {
  // Use a safer way to access the API key to avoid ReferenceError
  const apiKey = typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || process.env.API_KEY) : ((import.meta as any).env?.VITE_GEMINI_API_KEY);
  const ai = new GoogleGenAI({ apiKey: apiKey || "" });
  
  const history = followUps.map(f => {
    const timing = f.isEarly ? "EARLY" : "ON-TIME";
    return `${new Date(f.timestamp).toLocaleDateString()}: ${f.note} (${timing}, Method: ${f.method})`;
  }).join('\n');

  const prompt = `Analyze educational academy lead: ${client.name}, Current Status: ${client.status}. 
  Communication History:\n${history}\n
  Task: 
  1. Predict conversion score (High, Medium, Low).
  2. Analyze if early communication is working for this lead.
  3. Provide 1 professional recommendation in Arabic.`;

  try {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
    // Using gemini-3-pro-preview for advanced reasoning and sales prediction tasks.
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
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
    if (!jsonStr) return { score: 'Medium', reason: 'لم يتم استلام رد من الذكاء الاصطناعي' };
    
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Gemini predictSalesOpportunity error:", error);
    return { score: 'Medium', reason: 'حدث خطأ في التحليل الذكي' };
  }
};

/**
 * Provides automated analysis for daily sales reports.
 */
export const analyzeDailyReport = async (report: DailyReport) => {
  const apiKey = typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || process.env.API_KEY) : ((import.meta as any).env?.VITE_GEMINI_API_KEY);
  const ai = new GoogleGenAI({ apiKey: apiKey || "" });
  
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

  try {
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
    // Using gemini-3-flash-preview for standard text generation and summarization.
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    
    return response.text || "فشل تحليل التقرير بواسطة AI.";
  } catch (error) {
    console.error("Gemini analyzeDailyReport error:", error);
    return "فشل تحليل التقرير بواسطة AI.";
  }
};
