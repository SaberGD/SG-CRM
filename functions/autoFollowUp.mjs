// Personal check-in (اطمئنان) every 2 weeks for clients who booked (shared by the web app,
// the backfill/migration scripts and the Cloud Functions; pure, no Firestore imports).
//
// The check-in schedule lives on the client in its OWN field, `nextCheckInDate` (ms, 0/absent =
// none), so it never shows in the normal follow-up tabs, dashboard counts or alarm and can
// coexist with a normal follow-up date. One date per client at most, so nothing piles up.
// `autoFollowUp` keeps the on/off state (who/when/why, last done).
//
// Legacy: the first release stored the check-in in nextFollowUpDate with
// nextFollowUpSetVia === 'auto_booked'. checkInDate() still reads that until
// scripts/migrate-checkins.cjs has moved it.
//
// Writes that remove a field take `del` (firestore.deleteField() in the browser,
// FieldValue.delete() on the server). When `del` is undefined (creating a new document)
// those removals are simply left out.

export const AUTO_EVERY_DAYS = 14;
export const LEGACY_SET_VIA = 'auto_booked'; // old home of the check-in date (nextFollowUpSetVia)
export const AUTO_KIND = 'auto_booked'; // followups.kind of a done check-in
export const ACCOUNTING_STOP_REASON = 'الحجز اتلغى أو اترد (من الحسابات)';
export const STOP_REASONS = ['استرد', 'الكورس خلص', 'العميل طلب يوقف التواصل', 'أخرى'];
// Clients booked longer ago than this are not switched on automatically (owner: last 3 months).
export const RECENT_BOOKING_DAYS = 90;
export const ACCOUNTING_ACTOR = { by: 'system:accounting', byName: 'نظام الحسابات' };

const DAY = 86400000;
// Cairo days with a fixed UTC+2 offset: simple and consistent. In summer time (UTC+3) the
// check-in shows at 13:00 instead of 12:00, which does not matter for a day-level task.
const CAIRO_OFFSET = 2 * 3600000;
const NOON = 12 * 3600000;
const cairoDay = (ms) => Math.floor((ms + CAIRO_OFFSET) / DAY);
const noonOfDay = (day) => day * DAY - CAIRO_OFFSET + NOON;
const validMs = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * The first anchor + k*everyDays (k >= 1) at 12:00 Cairo that is not in the past.
 * Clients booked on different days therefore spread naturally over the cycle.
 */
export function nextAutoDate(anchorMs, nowMs = Date.now(), everyDays = AUTO_EVERY_DAYS) {
  const step = Math.max(1, Math.round(validMs(everyDays) ? everyDays : AUTO_EVERY_DAYS));
  const anchorDay = cairoDay(validMs(anchorMs) ? anchorMs : nowMs);
  let k = Math.max(1, Math.ceil((cairoDay(nowMs) - anchorDay) / step));
  while (noonOfDay(anchorDay + k * step) < nowMs) k++;
  return noonOfDay(anchorDay + k * step);
}

export const isBookedState = (c) => !!c && (c.status === 'booked' || c.isBooked === true);
export const isAutoOn = (c) => !!c && !!c.autoFollowUp && c.autoFollowUp.enabled === true;
export const isLegacyCheckIn = (c) => !!c && c.nextFollowUpSetVia === LEGACY_SET_VIA && validMs(c.nextFollowUpDate) && !validMs(c.nextCheckInDate);

// The pending check-in date (0 = none), reading the legacy location too.
export function checkInDate(c) {
  if (!c) return 0;
  if (validMs(c.nextCheckInDate)) return c.nextCheckInDate;
  return isLegacyCheckIn(c) ? c.nextFollowUpDate : 0;
}
export const isRecentBooking = (ms, nowMs = Date.now()) => validMs(ms) && ms >= nowMs - RECENT_BOOKING_DAYS * DAY;

// The newest booking date known for a client (CRM field, accounting field, ACTIVE accounting bookings).
export function bookingAnchor(c) {
  const dates = [c?.bookingDate, c?.accountingLatestBookingDate];
  Object.values(c?.accounting?.bookings || {}).forEach((b) => { if (b && b.status === 'ACTIVE') dates.push(b.bookingDate); });
  const valid = dates.filter(validMs);
  return valid.length ? Math.max(...valid) : 0;
}

// Fields to remove from a legacy check-in stored in the normal follow-up fields (only the
// ones that belong to it: a real follow-up date is never touched). {} for current docs.
export function legacyCheckInCleanup(client, del) {
  if (!client || client.nextFollowUpSetVia !== LEGACY_SET_VIA) return {};
  const patch = { nextFollowUpDate: 0 };
  if (!validMs(client.nextCheckInDate) && validMs(client.nextFollowUpDate)) patch.nextCheckInDate = client.nextFollowUpDate;
  if (del !== undefined) {
    Object.assign(patch, { nextFollowUpSetVia: del, nextFollowUpReason: del, nextFollowUpMethod: del,
      nextFollowUpReviewedBySales: del, nextFollowUpReviewedByName: del, nextFollowUpReviewedAt: del });
  }
  return patch;
}

/**
 * Turn the check-in on. Returns null when it is already on (idempotent).
 * opts: { now, anchor (booking date; default now), by, byName, via }
 */
export function planEnableAutoFollowUp(client, opts = {}, del) {
  if (isAutoOn(client)) return null;
  const now = validMs(opts.now) ? opts.now : Date.now();
  const prev = (client && client.autoFollowUp) || {};
  const autoFollowUp = {
    enabled: true, everyDays: AUTO_EVERY_DAYS, startedAt: now,
    startedBy: String(opts.by || ''), startedByName: String(opts.byName || ''), startedVia: String(opts.via || ''),
  };
  if (validMs(prev.lastDoneAt)) autoFollowUp.lastDoneAt = prev.lastDoneAt;
  return { ...legacyCheckInCleanup(client, del), autoFollowUp, nextCheckInDate: nextAutoDate(validMs(opts.anchor) ? opts.anchor : now, now) };
}

/**
 * Turn it off (the sales person, with a reason; or accounting after a refund/cancel).
 * Clears the check-in date. Returns null when already off.
 * opts: { now, by, byName, reason, reasonCode }
 */
export function planDisableAutoFollowUp(client, opts = {}, del) {
  if (!isAutoOn(client)) return null;
  const now = validMs(opts.now) ? opts.now : Date.now();
  const autoFollowUp = {
    ...client.autoFollowUp, enabled: false, stoppedAt: now,
    stoppedBy: String(opts.by || ''), stoppedByName: String(opts.byName || ''), stoppedReason: String(opts.reason || ''),
  };
  if (opts.reasonCode) autoFollowUp.stoppedReasonCode = String(opts.reasonCode);
  return { ...legacyCheckInCleanup(client, del), autoFollowUp, nextCheckInDate: 0 };
}

/**
 * The check-in was done ("تمت المتابعة"): next one 2 weeks after the contact. Only for the
 * check-in form; normal follow-ups never touch the check-in.
 * opts: { now, doneAt (when the contact happened; default now) }
 */
export function planCheckInDone(client, opts = {}, del) {
  if (!isAutoOn(client)) return {};
  const now = validMs(opts.now) ? opts.now : Date.now();
  const doneAt = validMs(opts.doneAt) && opts.doneAt <= now ? opts.doneAt : now;
  const lastDoneAt = Math.max(doneAt, validMs(client.autoFollowUp.lastDoneAt) ? client.autoFollowUp.lastDoneAt : 0);
  return { ...legacyCheckInCleanup(client, del), autoFollowUp: { ...client.autoFollowUp, lastDoneAt }, nextCheckInDate: nextAutoDate(doneAt, now) };
}

/** Quick reschedule of the check-in to a chosen time (the normal follow-up date is untouched). */
export function planCheckInReschedule(client, ts, del) {
  return { ...legacyCheckInCleanup(client, del), nextCheckInDate: ts };
}

/**
 * A client edited in the browser: switch on when it BECOMES booked (not booked before,
 * booked after). `after` is the client with the pending changes applied.
 */
export function planOnBecameBooked(before, after, opts = {}, del) {
  if (isBookedState(before) || !isBookedState(after)) return null;
  return planEnableAutoFollowUp(after, opts, del);
}

/**
 * Accounting sync (Cloud Function). `patch` is what planClientAccounting / the booking sync
 * will write. Switches on for a recent booking (last 90 days) when the client becomes
 * booked, gets a new booking, or never had the check-in; switches off when no booking is
 * ACTIVE any more. Payment updates of the same booking change nothing, so a sales person's
 * "off" stays off. Returns null when there is nothing to change (idempotent).
 * opts: { now, bookingId }
 */
export function planAccountingAutoFollowUp(current, patch, opts = {}, del) {
  const now = validMs(opts.now) ? opts.now : Date.now();
  const cur = current || {};
  if (patch && patch.isBooked === true) {
    if (isAutoOn(cur)) return null;
    const anchor = validMs(patch.bookingDate) ? patch.bookingDate : 0;
    if (!isRecentBooking(anchor, now)) return null;
    const id = opts.bookingId ? String(opts.bookingId) : '';
    const isNewBooking = !!id && !(cur.accounting && cur.accounting.bookings && cur.accounting.bookings[id]) &&
      !(Array.isArray(cur.accountingBookingIds) && cur.accountingBookingIds.includes(id));
    if (!cur.autoFollowUp || !isBookedState(cur) || isNewBooking) {
      return planEnableAutoFollowUp({ ...cur, ...patch }, { now, anchor, ...ACCOUNTING_ACTOR, via: 'accounting' }, del);
    }
    return null;
  }
  if (patch && patch.isBooked === false && isAutoOn(cur)) {
    return planDisableAutoFollowUp(cur, { now, ...ACCOUNTING_ACTOR, reason: ACCOUNTING_STOP_REASON, reasonCode: 'accounting_inactive' }, del);
  }
  return null;
}
