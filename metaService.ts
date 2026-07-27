export type MetaEventName = "Lead" | "Purchase";

// Deployed Firebase Cloud Function (see /functions/index.js) - not a secret,
// just a public HTTPS endpoint, same as any other API base URL.
const META_CAPI_URL = "https://us-central1-sg-crm-e3a38.cloudfunctions.net/metaCapiEvent";

interface SendMetaEventParams {
  eventName: MetaEventName;
  phone: string;
  value?: number;
  currency?: string;
  contentName?: string;
  contentCategory?: string;
  eventId?: string;
}

/**
 * Best-effort: reports a Lead/Purchase event to Meta Conversions API via a Firebase
 * Cloud Function, so Meta Ads can optimize on real CRM outcomes instead of just ad clicks.
 * Never blocks or throws into the calling UI flow.
 */
export const sendMetaEvent = ({ eventName, phone, value, currency, contentName, contentCategory, eventId }: SendMetaEventParams) => {
  if (!phone) return;
  fetch(META_CAPI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventName,
      phone,
      value,
      currency,
      contentName,
      contentCategory,
      eventId,
      sourceUrl: window.location.href,
    }),
  }).catch((error) => {
    console.error("sendMetaEvent error:", error);
  });
};
