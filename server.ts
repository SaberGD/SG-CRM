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
        return res.status(403).json({ error: "GEMINI_API_KEY is missing on server" });
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

      // Using gemini-3-pro-preview for advanced reasoning and sales prediction tasks.
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
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
      console.error("Gemini predictSalesOpportunity error:", error);
      res.json({ score: 'Medium', reason: `حدث خطأ في التحليل الذكي: ${error?.message || ''}` });
    }
  });

  // API Route: Analyze Daily Report
  app.post("/api/gemini/analyze-report", async (req, res) => {
    try {
      if (!apiKey) {
        return res.status(403).json({ error: "GEMINI_API_KEY is missing on the server" });
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

      // Using gemini-3.5-flash for standard text generation and summarization.
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
      });

      res.json({ text: response.text || "فشل تحليل التقرير بواسطة AI." });
    } catch (error: any) {
      console.error("Gemini analyzeDailyReport error:", error);
      res.json({ text: "فشل تحليل التقرير بواسطة AI." });
    }
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
