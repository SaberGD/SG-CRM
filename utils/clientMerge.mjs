// Merging duplicate CRM clients (same phone). Shared by the CLI script and the
// admin "Duplicates" page. Pure functions: no Firebase imports.

export const normalizePhoneKey = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-10) : '';
};

export const normalizeName = (name) =>
  String(name || '')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ').trim().toLowerCase();

const STATUS_RANK = { booked: 4, interested: 3, potential: 2, not_interested: 1 };
const BOOKING_FIELDS = ['isBooked', 'bookedCourseId', 'bookedCourseName', 'totalPrice', 'paidAmount', 'remainingAmount',
  'bookingDate', 'originalCurrency', 'originalTotalPrice', 'originalPaidAmount', 'exchangeRateUsed', 'deductionAmount', 'deductionReason',
  'accountingBookingIds', 'accountingLastSyncedAt', 'accounting'];

const hasMoney = (c) => (c.status === 'booked' || c.isBooked) && ((c.totalPrice || 0) > 0 || (c.paidAmount || 0) > 0);

/**
 * group: client objects (with .id). ctx: { followupCounts: {clientId: n}, poolAgentIds: Set }
 * Returns { ok, reason?, primaryId, duplicateIds, patch }.
 * Anything ambiguous (two real sales agents, two different paid bookings) is NOT merged.
 */
export function planMerge(group, ctx = {}) {
  const counts = ctx.followupCounts || {};
  const pool = ctx.poolAgentIds || new Set();
  if (group.length < 2) return { ok: false, reason: 'single' };

  const realAgents = new Set(group.filter((c) => c.salesAgentId && !pool.has(c.salesAgentId)).map((c) => c.salesAgentId));
  if (realAgents.size > 1) return { ok: false, reason: 'multiple_agents' };

  const money = group.filter(hasMoney);
  // Same price but different paid amounts = the same booking at different payment stages:
  // keep the most complete one. Different prices = different bookings: needs a human.
  if (money.length > 1 && !money.every((c) => (c.totalPrice || 0) === (money[0].totalPrice || 0))) return { ok: false, reason: 'financial_conflict' };

  const score = (c) =>
    (hasMoney(c) ? 100 : 0) + (c.salesAgentId && !pool.has(c.salesAgentId) ? 50 : 0) + (counts[c.id] || 0) - (c.createdAt || 0) / 1e15;
  const sorted = [...group].sort((a, b) => score(b) - score(a));
  const primary = sorted[0];
  const dups = sorted.slice(1);

  const patch = {};
  // status: the "furthest" one wins
  const best = group.reduce((a, c) => ((STATUS_RANK[c.status] || 0) > (STATUS_RANK[a.status] || 0) ? c : a), primary);
  if (best.status !== primary.status) patch.status = best.status;
  // booking + money come from the one that has them
  const booked = money.length ? money.reduce((a, c) => ((c.paidAmount || 0) > (a.paidAmount || 0) ? c : a), money[0]) : group.find((c) => c.isBooked);
  if (booked && booked.id !== primary.id) for (const f of BOOKING_FIELDS) if (booked[f] !== undefined) patch[f] = booked[f];
  // owner: a real agent beats the shared pool account
  if (primary.salesAgentId && pool.has(primary.salesAgentId)) {
    const real = group.find((c) => c.salesAgentId && !pool.has(c.salesAgentId));
    if (real) { patch.salesAgentId = real.salesAgentId; patch.salesAgentName = real.salesAgentName; }
  }
  // union / combine
  const labels = [...new Set(group.flatMap((c) => c.labels || []))];
  if (labels.length !== (primary.labels || []).length) patch.labels = labels;
  const notes = [...new Set(group.map((c) => (c.notes || '').trim()).filter(Boolean))];
  if (notes.length > 1) patch.notes = notes.join('\n— (من سجل مكرر) —\n');
  const transfers = group.flatMap((c) => c.transferHistory || []);
  if (transfers.length > (primary.transferHistory || []).length) patch.transferHistory = transfers;
  const lastFU = Math.max(0, ...group.map((c) => c.lastFollowUpDate || 0));
  if (lastFU && lastFU !== primary.lastFollowUpDate) patch.lastFollowUpDate = lastFU;
  const nexts = group.map((c) => c.nextFollowUpDate).filter(Boolean);
  if (nexts.length && Math.min(...nexts) !== primary.nextFollowUpDate) patch.nextFollowUpDate = Math.min(...nexts);
  const created = Math.min(...group.map((c) => c.createdAt || Infinity));
  if (Number.isFinite(created) && created !== primary.createdAt) patch.createdAt = created;
  patch.mergedFromIds = [...new Set([...(primary.mergedFromIds || []), ...dups.map((d) => d.id)])];
  return { ok: true, primaryId: primary.id, duplicateIds: dups.map((d) => d.id), patch };
}
