// Read-only export of CRM collections for the accounting project's data analyst.
// Personal contact data and free-text notes never leave the CRM.
const EXPORTABLE = {
  clients: { drop: ["phone", "phoneKey", "phoneKeys", "profileLink", "notes", "chatId", "chatwootContactId", "distinctiveSearchPhrase", "automationSalesRepNameRaw", "aiRecommendation", "transferHistory"] },
  followups: { drop: ["note", "salesBrief", "result", "chatwootConversationId"] },
  services: { drop: [] },
  labels: { drop: [] },
  reports: { drop: ["notes"] },
  shifts: { drop: [] },
  transfers: { drop: [] },
  users: { only: ["name", "role", "isDeactivated", "createdAt"] },
};

const MAX_PAGE = 1000;

function sanitizeDoc(collection, id, data) {
  const spec = EXPORTABLE[collection];
  if (spec.only) return { id, ...Object.fromEntries(spec.only.filter((k) => data[k] !== undefined).map((k) => [k, data[k]])) };
  const out = { id };
  for (const [k, v] of Object.entries(data)) if (!spec.drop.includes(k)) out[k] = v;
  return out;
}

const isExportable = (c) => Object.prototype.hasOwnProperty.call(EXPORTABLE, c);
const pageSize = (n) => Math.max(1, Math.min(Number(n) || MAX_PAGE, MAX_PAGE));

module.exports = { EXPORTABLE, sanitizeDoc, isExportable, pageSize, MAX_PAGE };
