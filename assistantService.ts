import { auth } from "./firebase";

const BRIDGE_URL = "https://us-central1-sg-crm-e3a38.cloudfunctions.net/accountingCrmBridge";

export type ChatMessage = { role: "user" | "assistant"; content: string };

// Talks to the CRM assistant (read-only). Sends the signed-in user's ID token.
export async function askMaro(messages: ChatMessage[]): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("سجّل دخولك الأول.");
  const res = await fetch(BRIDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ action: "assistant", messages: messages.slice(-12) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "المساعد مش متاح دلوقتي.");
  return String(data.reply || "");
}
