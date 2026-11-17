// Meta Conversions API: Purchase events built from accounting bookings (pure logic + sender).
// The accounting system is the source of truth for bookings, so every new ACTIVE booking that
// reaches the CRM through the ingest sync is reported to Meta once, server-side, with the
// booking ID as event_id (Meta drops repeats of the same event_id).
const crypto = require("crypto");

const GRAPH_VERSION = "v21.0";
// Meta rejects or ignores events much older than this; older bookings (first sync, resyncs)
// are never sent.
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const sha256 = (value) => crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");

const COUNTRY_BY_CODE = { 20: "eg", 966: "sa", 971: "ae", 965: "kw", 974: "qa", 968: "om", 973: "bh", 962: "jo", 249: "sd", 218: "ly", 212: "ma", 216: "tn", 213: "dz", 964: "iq" };

// Meta wants the full international number, digits only, no leading zeros.
function internationalPhone(raw, countryCode) {
  let digits = String(raw || "").replace(/\D/g, "").replace(/^00/, "");
  const cc = String(countryCode || "+20").replace(/\D/g, "") || "20";
  if (!digits) return "";
  if (digits.startsWith("0")) digits = cc + digits.replace(/^0+/, "");
  else if (!digits.startsWith(cc) && digits.length <= 10) digits = cc + digits;
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

function customerUserData(customer, clientId) {
  const phones = [customer?.fullWhatsapp, customer?.whatsapp, customer?.phone]
    .map((p) => internationalPhone(p, customer?.countryCode))
    .filter(Boolean);
  const userData = { ph: [...new Set(phones)].map(sha256) };
  const email = String(customer?.email || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) userData.em = [sha256(email)];
  const words = String(customer?.name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length) userData.fn = [sha256(words[0])];
  if (words.length > 1) userData.ln = [sha256(words[words.length - 1])];
  const country = COUNTRY_BY_CODE[String(customer?.countryCode || "+20").replace(/\D/g, "")];
  if (country) userData.country = [sha256(country)];
  if (clientId) userData.external_id = [sha256(clientId)];
  return userData;
}

// When the booking happened: its creation time, else its booking date (noon Cairo).
function bookingEventMs(booking) {
  const created = Date.parse(String(booking?.createdAt || ""));
  if (Number.isFinite(created)) return created;
  const d = String(booking?.bookingDate || "");
  const t = /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T12:00:00+03:00`) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

/**
 * The Purchase event for one accounting booking, or { skip: reason }.
 * summary: accountingIngest.summarizeBooking(...) of the same booking.
 */
function purchaseEventForBooking({ bookingId, booking, customer, summary, clientId, now = Date.now() }) {
  if (summary.status !== "ACTIVE") return { skip: "inactive" };
  const at = bookingEventMs(booking);
  if (!Number.isFinite(at)) return { skip: "no_date" };
  if (now - at > MAX_EVENT_AGE_MS) return { skip: "too_old" };
  const userData = customerUserData(customer, clientId);
  if (!userData.ph.length && !userData.em) return { skip: "no_contact" };
  return {
    event: {
      event_name: "Purchase",
      event_time: Math.floor(Math.min(at, now) / 1000),
      event_id: `booking_${bookingId}`,
      action_source: "system_generated",
      user_data: userData,
      custom_data: {
        currency: "EGP",
        value: summary.total,
        order_id: bookingId,
        content_name: summary.courseName || undefined,
        content_ids: summary.productId ? [summary.productId] : undefined,
        content_type: "product",
        content_category: summary.productType || undefined,
      },
    },
  };
}

async function sendEvents({ pixelId, accessToken, events, testEventCode, fetchImpl = fetch }) {
  const body = { data: events };
  if (testEventCode) body.test_event_code = String(testEventCode);
  const res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Meta rejected the event: ${json?.error?.message || res.status}`);
    err.meta = json?.error ? { code: json.error.code, type: json.error.type, message: json.error.message } : { status: res.status };
    throw err;
  }
  return { eventsReceived: json.events_received ?? null, fbtraceId: json.fbtrace_id || null };
}

module.exports = { sha256, internationalPhone, customerUserData, bookingEventMs, purchaseEventForBooking, sendEvents, MAX_EVENT_AGE_MS };
