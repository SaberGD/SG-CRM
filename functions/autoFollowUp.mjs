// Automatic personal follow-up every 2 weeks for clients who booked (shared by the web app,
// the backfill script and the Cloud Functions; pure, no Firestore imports).
//
// The schedule lives on the client like every other follow-up: ONE nextFollowUpDate per
// client, so nothing can pile up. An automatic date is marked nextFollowUpSetVia='auto_booked'
// and is a normal schedule: it needs no AI review and never blocks a shift.
// A date the sales person or the AI set is never overwritten by the automation.
//
// Writes that remove a field take `del` (firestore.deleteField() in the browser,
// FieldValue.delete() on the server). When `del` is undefined (creating a new document)
// those removals are simply left out.

export const AUTO_EVERY_DAYS = 14;
export const AUTO_SET_VIA = 'auto_booked';
export const AUTO_KIND = 'auto_booked';
export const AUTO_REASON = 'متابعة شخصية كل أسبوعين (عميل حاجز)';
export const ACCOUNTING_STOP_REASON = 'الحجز اتلغى أو اترد (من الحسابات)';
export const STOP_REASONS = ['استرد', 'الكورس خلص', 'العميل طلب يوقف التواصل', 'أخرى'];
// Clients booked longer ago than this are not switched on automatically (owner: last 3 months).
export const RECENT_BOOKING_DAYS = 90;
export const ACCOUNTING_ACTOR = { by: 'system:accounting', byName: 'نظام الحسابات' };

const DAY = 86400000;
// Cairo days with a fixed UTC+2 offset: simple and consistent. In summer time (UTC+3) the
// follow-up shows at 13:00 instead of 12:00, which does not matter for a day-level task.
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
export const isAutoScheduled = (c) => !!c && c.nextFollowUpSetVia === AUTO_SET_VIA && validMs(c.nextFollowUpDate);
// A date set by a person or by the AI (future or overdue): the automation leaves it alone.
export const hasOtherSchedule = (c) => !!c && validMs(c.nextFollowUpDate) && c.nextFollowUpSetVia !== AUTO_SET_VIA;
export const isRecentBooking = (ms, nowMs = Date.now()) => validMs(ms) && ms >= nowMs - RECENT_BOOKING_DAYS * DAY;

// The newest booking date known for a client (CRM field, accounting field, ACTIVE accounting bookings).
export function bookingAnchor(c) {
  const dates = [c?.bookingDate, c?.accountingLatestBookingDate];
  Object.values(c?.accounting?.bookings || {}).forEach((b) => { if (b && b.status === 'ACTIVE') dates.push(b.bookingDate); });
  const valid = dates.filter(validMs);
  return valid.length ? Math.max(...valid) : 0;
}

function autoSchedule(date, del) {
  const patch = { nextFollowUpDate: date, nextFollowUpSetVia: AUTO_SET_VIA, nextFollowUpReason: AUTO_REASON };
  if (del !== undefined) {
    // The previous method / AI review flags belonged to another schedule.
    Object.assign(patch, { nextFollowUpMethod: del, nextFollowUpReviewedBySales: del, nextFollowUpReviewedByName: del, nextFollowUpReviewedAt: del });
  }
  return patch;
}

/**
 * Turn the automatic follow-up on. Returns null when it is already on (idempotent).
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
  const patch = { autoFollowUp };
  if (!hasOtherSchedule(client)) Object.assign(patch, autoSchedule(nextAutoDate(validMs(opts.anchor) ? opts.anchor : now, now), del));
  return patch;
}

/**
 * Turn it off (the sales person, with a reason; or accounting after a refund/cancel).
 * Clears the date only when it is the automatic one. Returns null when already off.
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
  const patch = { autoFollowUp };
  if (client.nextFollowUpSetVia === AUTO_SET_VIA) {
    patch.nextFollowUpDate = 0;
    if (del !== undefined) Object.assign(patch, { nextFollowUpSetVia: del, nextFollowUpReason: del, nextFollowUpMethod: del });
  }
  return patch;
}

/**
 * After any follow-up is logged for a client: if the automatic follow-up is on and the
 * sales person did not pick a specific next date, the next one is 2 weeks after the contact.
 * opts: { now, doneAt (when the contact happened; default now), manualNextTs }
 */
export function planAutoAfterFollowUp(client, opts = {}, del) {
  if (!isAutoOn(client)) return {};
  const now = validMs(opts.now) ? opts.now : Date.now();
  const doneAt = validMs(opts.doneAt) && opts.doneAt <= now ? opts.doneAt : now;
  const patch = { autoFollowUp: { ...client.autoFollowUp, lastDoneAt: Math.max(doneAt, validMs(client.autoFollowUp.lastDoneAt) ? client.autoFollowUp.lastDoneAt : 0) } };
  if (!validMs(opts.manualNextTs)) Object.assign(patch, autoSchedule(nextAutoDate(doneAt, now), del));
  return patch;
}

/**
 * A person sets a specific date on a client whose current date is the automatic one:
 * from now on that date is theirs (so turning the automation off will not remove it).
 */
export function manualOverridePatch(client, del) {
  if (!client || client.nextFollowUpSetVia !== AUTO_SET_VIA) return {};
  const patch = { nextFollowUpSetVia: 'manual' };
  if (del !== undefined) patch.nextFollowUpReason = del;
  return patch;
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
 * booked, gets a new booking, or never had the automation; switches off when no booking is
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
