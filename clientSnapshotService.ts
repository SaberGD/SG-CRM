import { auth } from "./firebase";
import type { ClientSnapshot360 } from "./types";

const BRIDGE_URL = "https://us-central1-sg-crm-e3a38.cloudfunctions.net/accountingCrmBridge";

// "سحب ملف العميل": asks the server to pull the client's data from accounting and training and
// store it as clients/{id}.snapshot360. Only on demand; the page reads the stored snapshot from the
// client document it already listens to (the browser never writes snapshot360).
export async function pullClientSnapshot(clientId: string, force: boolean): Promise<{ cached: boolean; snapshot: ClientSnapshot360 }> {
  const user = auth.currentUser;
  if (!user) throw new Error("سجّل دخولك الأول.");
  const res = await fetch(BRIDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ action: "clientSnapshot", clientId, force }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "ماقدرناش نسحب ملف العميل دلوقتي.");
  return { cached: !!data.cached, snapshot: data.snapshot };
}
