const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");

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
