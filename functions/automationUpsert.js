// Pure decision logic for upsertClientFromAutomation (n8n -> CRM). No Firestore here, so every
// rule is unit-tested in automationUpsert.test.js. The request contract is documented in
// docs/automation-contract.md and above the handler in index.js.

// ---------------------------------------------------------------------------
// Input limits and type checks
// ---------------------------------------------------------------------------

// Longest value kept for each free-text field (longer text is cut, not rejected).
const TEXT_LIMITS = {
  customer_name: 120,
  customer_phone: 32,
  country_code: 6,
  position: 120,
  governorate: 60,
  city: 60,
  sales_brief: 2000,
  detailed_result: 2000,
  suggested_status: 40,
  suggested_service: 120,
  next_followup_date: 64,
  next_followup_channel: 40,
  next_followup_reason: 500,
  distinctive_search_phrase: 280,
  search_phrase: 280,
  meta_search_phrase: 280,
  sales_rep_name: 120,
  source: 40,
  profile_link: 500,
  chatwoot_conversation_link: 500,
  chatwoot_conversation_id: 64,
  conversation_id: 64,
  chatwoot_contact_id: 64,
  gender: 20,
  has_laptop: 20,
  attendance_mode: 20,
  automation_mode: 40,
  run_mode: 40,
  ad_code: 20,
  first_message_at: 64,
  last_contact_at: 64,
  last_followup_date: 64,
  last_followup_at: 64,
  last_contacted_at: 64,
  last_message_at: 64,
  chatwoot_last_activity_at: 64,
};

// Arrays: max items and max length of each item.
const LIST_LIMITS = {
  suggested_labels: { items: 20, length: 60 },
  missing_or_ambiguous_fields: { items: 20, length: 80 },
};

// Beyond these the payload is not a real extraction: reject with 400.
const HARD_LIMITS = { bodyChars: 100000, textChars: 20000, listItems: 100 };

// Fields that may also come as numbers (ids, phones, unix times).
const NUMBER_OK = new Set([
  "customer_phone", "chatwoot_conversation_id", "conversation_id", "chatwoot_contact_id",
  "first_message_at", "last_contact_at", "last_followup_date", "last_followup_at", "last_contacted_at",
  "last_message_at", "chatwoot_last_activity_at", "next_followup_date",
]);

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Returns null when the body is acceptable, else a short reason (sent back with a 400). */
function validateAutomationBody(body) {
  if (!isPlainObject(body)) return "body must be a JSON object";
  let size = 0;
  try { size = JSON.stringify(body).length; } catch (e) { return "body is not serialisable"; }
  if (size > HARD_LIMITS.bodyChars) return "body too large";
  for (const field of Object.keys(TEXT_LIMITS)) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    if (typeof v === "number") {
      if (!NUMBER_OK.has(field) || !Number.isFinite(v)) return `${field} must be a string`;
      continue;
    }
    if (typeof v !== "string") return `${field} must be a string`;
    if (v.length > HARD_LIMITS.textChars) return `${field} too long`;
  }
  for (const field of Object.keys(LIST_LIMITS)) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v)) return `${field} must be an array`;
    if (v.length > HARD_LIMITS.listItems) return `${field} has too many items`;
    if (v.some((x) => typeof x !== "string" || x.length > HARD_LIMITS.textChars)) return `${field} must hold short strings`;
  }
  for (const field of ["has_meaningful_content", "booked"]) {
    const v = body[field];
    if (v !== undefined && v !== null && typeof v !== "boolean" && typeof v !== "string") return `${field} must be a boolean`;
  }
  return null;
}

const clipText = (v, max) => String(v).replace(/\s+/g, " ").trim().slice(0, max);
// Multi-line text keeps its line breaks (briefs and results are read as paragraphs).
const clipBlock = (v, max) => String(v).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const BLOCK_FIELDS = new Set(["sales_brief", "detailed_result"]);

/**
 * A copy of the body with every known field trimmed to its limit. Unknown fields are dropped,
 * so nothing unbounded can reach Firestore. Call validateAutomationBody first.
 */
function sanitizeAutomationBody(body) {
  const out = {};
  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    if (typeof v === "number") { out[field] = v; continue; }
    out[field] = BLOCK_FIELDS.has(field) ? clipBlock(v, max) : clipText(v, max);
  }
  for (const [field, lim] of Object.entries(LIST_LIMITS)) {
    const v = body[field];
    if (!Array.isArray(v)) continue;
    out[field] = v.map((x) => clipText(x, lim.length)).filter(Boolean).slice(0, lim.items);
  }
  if (body.has_meaningful_content !== undefined) out.has_meaningful_content = body.has_meaningful_content === false || body.has_meaningful_content === "false" ? false : body.has_meaningful_content;
  if (body.booked !== undefined) out.booked = body.booked === true || body.booked === "true";
  if (out.country_code !== undefined && !/^\+?\d{1,4}$/.test(out.country_code)) delete out.country_code;
  if (out.country_code && !out.country_code.startsWith("+")) out.country_code = `+${out.country_code}`;
  return out;
}

// ---------------------------------------------------------------------------
// Ad attribution (first touch wins)
// ---------------------------------------------------------------------------

/** "n12" -> "N12". Anything that is not 1-3 letters + 1-4 digits is ignored (''). */
function parseAdCode(raw) {
  if (typeof raw !== "string") return "";
  const code = raw.trim().toUpperCase().slice(0, 20);
  return /^[A-Z]{1,3}\d{1,4}$/.test(code) ? code : "";
}

const EARLIEST_SANE_MS = Date.parse("2020-01-01T00:00:00Z");

/** A timestamp in ms from number (s or ms) / numeric string / ISO; 0 when missing or absurd. */
function parseTimestamp(value, now = Date.now()) {
  if (value === undefined || value === null || value === "") return 0;
  let ts = NaN;
  if (typeof value === "number") ts = value < 1e11 ? value * 1000 : value;
  else if (typeof value === "string") {
    const raw = value.trim();
    if (/^\d+$/.test(raw)) { const n = Number(raw); ts = n < 1e11 ? n * 1000 : n; }
    else ts = Date.parse(raw);
  }
  if (!Number.isFinite(ts) || ts < EARLIEST_SANE_MS || ts > now + 24 * 3600 * 1000) return 0;
  return Math.round(ts);
}

/** Fields to set on the client for attribution: only the ones the client does not have yet. */
function firstTouchFields(existing, { adCode, firstMessageAt }) {
  const out = {};
  if (adCode && !existing?.adCode) out.adCode = adCode;
  if (firstMessageAt && !existing?.firstMessageAt) out.firstMessageAt = firstMessageAt;
  return out;
}

/** The ad code a follow-up carries: this conversation's code, else the client's first-touch code. */
function followUpAdCode(existing, adCode) {
  return adCode || existing?.adCode || null;
}

// ---------------------------------------------------------------------------
// Status (never downgrade, never touch human-only states)
// ---------------------------------------------------------------------------

const ALLOWED_AUTO_STATUSES = ["interested", "potential", "not_interested"];

function mapSuggestedStatus(raw) {
  const key = String(raw || "").toLowerCase().trim();
  if (key === "booked") return { status: "potential", bookedMentioned: true };
  if (ALLOWED_AUTO_STATUSES.includes(key)) return { status: key, bookedMentioned: false };
  return { status: "potential", bookedMentioned: false };
}

/**
 * The status to write, or null to leave it as it is.
 * - new client: the mapped suggestion (booked -> potential + bookedMentioned).
 * - booked / isBooked / not_interested: never touched (human or accounting decisions).
 * - interested: never changed by automation (no downgrade to potential, and a lost lead is
 *   a salesperson's call, not the AI's).
 * - potential (or empty/unknown): may move to the suggestion.
 */
function decideAutomationStatus(existing, suggestedRaw) {
  const { status, bookedMentioned } = mapSuggestedStatus(suggestedRaw);
  if (!existing) return { status, bookedMentioned };
  const current = String(existing.status || "");
  if (current === "booked" || existing.isBooked === true || current === "not_interested") return { status: null, bookedMentioned };
  if (current === "interested") return { status: null, bookedMentioned };
  if (current === status) return { status: null, bookedMentioned };
  return { status, bookedMentioned };
}

// ---------------------------------------------------------------------------
// Follow-up dates (owner rule: only a date the customer asked for or the salesperson promised)
// ---------------------------------------------------------------------------

function isAutomationSuggestedDate(body) {
  return Array.isArray(body?.missing_or_ambiguous_fields) &&
    body.missing_or_ambiguous_fields.includes("next_followup_date_suggested_not_explicit");
}

function parseFollowUpDate(raw) {
  if (raw === undefined || raw === null || raw === "") return 0;
  const t = typeof raw === "number" ? (raw < 1e11 ? raw * 1000 : raw) : new Date(String(raw)).getTime();
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/**
 * set: fields for the client when the date is explicit AND in the future (queued for the
 *      agent's Accept with nextFollowUpReviewedBySales:false), else null.
 * suggestion: { automationSuggestedFollowUp } when the date is only suggested or already past;
 *      nextFollowUpDate is then left untouched.
 */
function planAutomationFollowUpDate({ body, method, now = Date.now() }) {
  const at = parseFollowUpDate(body?.next_followup_date);
  if (!at) return { set: null, suggestion: null, explicitFuture: false };
  const reasonText = body?.next_followup_reason ? String(body.next_followup_reason).trim() : "";
  const suggested = isAutomationSuggestedDate(body);
  if (suggested || at <= now) {
    return {
      set: null,
      explicitFuture: false,
      suggestion: { automationSuggestedFollowUp: { at, channel: method, reason: suggested ? "suggested" : "past", note: reasonText, receivedAt: now } },
    };
  }
  return {
    set: {
      nextFollowUpDate: at,
      nextFollowUpMethod: method,
      nextFollowUpSetVia: "ai_automation",
      nextFollowUpReason: reasonText,
      nextFollowUpReviewedBySales: false,
    },
    suggestion: null,
    explicitFuture: true,
  };
}

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

const createdMs = (d) => (typeof d?.createdAt === "number" ? d.createdAt : Number(d?.createdAt?.toMillis?.() ?? Infinity));

/**
 * docs: [{ id, data }] matching the same phone. Picks the oldest client (createdAt, then id) so
 * the choice is the same on every call. ambiguous tells the caller to record it (never create a third).
 */
function pickDedupeMatch(docs) {
  const list = (docs || []).filter(Boolean);
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => (createdMs(a.data) - createdMs(b.data)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { pick: sorted[0], ambiguous: sorted.length > 1, candidateIds: sorted.map((d) => d.id) };
}

/** Fields to add when an existing client has no phoneKey yet (legacy docs). */
function phoneKeyBackfill(existing, phoneKey) {
  if (!phoneKey) return {};
  const out = {};
  if (!existing?.phoneKey) out.phoneKey = phoneKey;
  const keys = Array.isArray(existing?.phoneKeys) ? existing.phoneKeys : [];
  if (!keys.includes(phoneKey)) out.phoneKeys = [...new Set([...keys, ...(existing?.phoneKey ? [existing.phoneKey] : []), phoneKey])];
  return out;
}

// ---------------------------------------------------------------------------
// Phones
// ---------------------------------------------------------------------------

/** Mirrors ClientsList.tsx's handleAddClient phone normalization. */
function normalizeIncomingPhone(rawPhone, countryCode) {
  if (rawPhone === undefined || rawPhone === null || rawPhone === "") return null;
  const cc = countryCode || "+20";
  let digits = String(rawPhone).replace(/\D/g, "");
  if (!digits) return null;
  const ccDigits = cc.replace(/\D/g, "");
  if (ccDigits && digits.startsWith(ccDigits)) digits = digits.substring(ccDigits.length);
  digits = digits.replace(/^0+/, "");
  if (!digits) return null;
  return cc + digits;
}

/** Mirrors ClientsList.tsx's dedup phoneVariations logic (legacy docs without phoneKey). */
function buildPhoneVariations(phoneFull) {
  const digitsOnly = phoneFull.replace(/\D/g, "");
  const variations = new Set([phoneFull, digitsOnly]);
  if (phoneFull.startsWith("+20")) {
    const core = phoneFull.substring(3);
    variations.add("0" + core);
    variations.add(core);
    variations.add("20" + core);
  } else if (digitsOnly.startsWith("20")) {
    const core = digitsOnly.substring(2);
    variations.add("+20" + core);
    variations.add("0" + core);
    variations.add(core);
  }
  return Array.from(variations).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** allLabels: [{ id, text }]. Exact text first, then containment (as before). */
function matchLabelIdsFrom(allLabels, suggestedLabels) {
  if (!Array.isArray(suggestedLabels) || !suggestedLabels.length) return [];
  const labels = (allLabels || []).map((l) => ({ id: l.id, text: String(l.text || "").toLowerCase().trim() })).filter((l) => l.text);
  const matched = [];
  for (const raw of suggestedLabels) {
    const needle = String(raw || "").trim().toLowerCase();
    if (!needle) continue;
    const hit = labels.find((l) => l.text === needle) || labels.find((l) => l.text.includes(needle) || needle.includes(l.text));
    if (hit) matched.push(hit.id);
  }
  return [...new Set(matched)];
}

module.exports = {
  TEXT_LIMITS, LIST_LIMITS, HARD_LIMITS,
  validateAutomationBody, sanitizeAutomationBody,
  parseAdCode, parseTimestamp, firstTouchFields, followUpAdCode,
  mapSuggestedStatus, decideAutomationStatus,
  isAutomationSuggestedDate, parseFollowUpDate, planAutomationFollowUpDate,
  pickDedupeMatch, phoneKeyBackfill,
  normalizeIncomingPhone, buildPhoneVariations,
  matchLabelIdsFrom,
};
