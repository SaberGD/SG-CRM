// Maps a sales name written by another system (accounting's salesName, n8n's sales_rep_name) to a
// CRM user. Pure: the caller passes the active users and the alias map.
//
// Aliases live in Firestore (app_settings/salesNameAliases, { aliases: { "<name>": "<uid or CRM name>" } }),
// not in this public repo. Without the doc, matching still works on the users' own names.
//
// Safer than the old two-way substring match: exact first, then whole-word prefix, then shared
// words; when two users match equally well nobody is picked (the caller falls back to the
// default agent) instead of the first one found.

function normalizeAgentName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** { aliases: {...} } or a bare map -> Map(normalized name -> raw target). Bad entries are dropped. */
function normalizeAliasMap(doc) {
  const src = doc && typeof doc === "object" ? (doc.aliases && typeof doc.aliases === "object" ? doc.aliases : doc) : {};
  const out = new Map();
  for (const [k, v] of Object.entries(src)) {
    const key = normalizeAgentName(k);
    const target = typeof v === "string" ? v.trim() : "";
    if (key && target && key.length <= 120 && target.length <= 200) out.set(key, target);
  }
  return out;
}

const words = (s) => s.split(" ").filter(Boolean);
const startsWithWords = (long, short) => {
  const a = words(long), b = words(short);
  return b.length > 0 && b.length <= a.length && b.every((w, i) => a[i] === w);
};

// 3 = exact (name, e-mail or e-mail local part), 2 = whole-word prefix either way,
// 1 = every word of the shorter side is a word of the other, 0 = no match.
function matchTier(user, target) {
  const name = normalizeAgentName(user.name);
  const rawEmail = String(user.email || "").trim().toLowerCase();
  const email = normalizeAgentName(rawEmail);
  const local = normalizeAgentName(rawEmail.split("@")[0]);
  if ((name && name === target) || (email && email === target) || (local && local === target)) return 3;
  if (name && (startsWithWords(name, target) || startsWithWords(target, name))) return 2;
  if (name) {
    const a = words(name), b = words(target);
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    if (shorter.length && shorter.every((w) => w.length >= 3 && longer.includes(w))) return 1;
  }
  return 0;
}

/**
 * users: [{ id, name, email, isDeactivated }]. Returns { id, name } or null.
 * An alias whose target is a user id picks that user directly (when active).
 */
function matchAgent(users, rawName, aliasMap = new Map()) {
  let target = normalizeAgentName(rawName);
  if (!target) return null;
  const active = (users || []).filter((u) => u && u.id && u.isDeactivated !== true);
  const aliased = aliasMap.get(target);
  if (aliased) {
    const byId = active.find((u) => u.id === aliased);
    if (byId) return { id: byId.id, name: byId.name || byId.email || "موظف مبيعات" };
    target = normalizeAgentName(aliased) || target;
  }
  let best = 0, hits = [];
  for (const u of active) {
    const tier = matchTier(u, target);
    if (!tier) continue;
    if (tier > best) { best = tier; hits = [u]; } else if (tier === best) hits.push(u);
  }
  if (hits.length !== 1) return null;
  return { id: hits[0].id, name: hits[0].name || hits[0].email || "موظف مبيعات" };
}

module.exports = { normalizeAgentName, normalizeAliasMap, matchTier, matchAgent };
