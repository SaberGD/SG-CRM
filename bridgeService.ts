import { auth } from "./firebase";

// Staff actions on the accountingCrmBridge function (signed-in staff token). New actions are
// unknown to the currently deployed function (it answers 400 "Invalid action"), so callers
// must treat BridgeUnavailable as "use the old way".
const BRIDGE_URL = "https://us-central1-sg-crm-e3a38.cloudfunctions.net/accountingCrmBridge";

export class BridgeUnavailable extends Error {}

export async function callBridge<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("سجّل دخولك الأول.");
  let res: Response;
  try {
    res = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (e) {
    throw new BridgeUnavailable("network");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 400 && data?.error === "Invalid action") throw new BridgeUnavailable("action not deployed");
  if (!res.ok) throw new Error(data?.error || "الخدمة مش متاحة دلوقتي.");
  return data as T;
}

export interface PhoneCheckResult {
  exists: boolean;
  client?: { id: string; name: string; salesAgentName: string; status: string; createdAt: number; mine: boolean };
}
export const phoneCheck = (phone: string, countryCode: string) => callBridge<PhoneCheckResult>("phoneCheck", { phone, countryCode });

export interface IntegrationHealth {
  openSyncReview: number | null; failedAutomation24h: number | null; lastIngestAt: number | null; lastAutomationAt: number | null;
  errors?: Record<string, string>;
}
export const integrationHealth = () => callBridge<IntegrationHealth>("integrationHealth");

export const linkSyncReview = (bookingId: string, clientId: string) =>
  callBridge<{ success: boolean; clientId: string; changedFields: string[]; alreadyLinked?: boolean }>("linkSyncReview", { bookingId, clientId });
