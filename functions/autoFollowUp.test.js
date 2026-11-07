const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { summarizeBooking, planClientAccounting, newClientFromBooking } = require("./accountingIngest");
const load = () => import(path.join(__dirname, "autoFollowUp.mjs"));

const DAY = 86400000;
const DEL = { __delete: true }; // stands in for FieldValue.delete()
// 2026-11-07 15:00 Cairo (UTC+2) = 13:00 UTC
const NOW = Date.UTC(2026, 10, 7, 13, 0, 0);
const noonCairo = (y, m, d) => Date.UTC(y, m - 1, d, 10, 0, 0); // 12:00 at UTC+2

test("nextAutoDate: anchor + k*14 days at noon Cairo, never in the past", async () => {
  const { nextAutoDate } = await load();
  // booked today -> in exactly 2 weeks
  assert.equal(nextAutoDate(NOW, NOW), noonCairo(2026, 11, 21));
  // booked 20 days ago (Oct 18) -> Oct 18 + 28 = Nov 15
  assert.equal(nextAutoDate(Date.UTC(2026, 9, 18, 8), NOW), noonCairo(2026, 11, 15));
  // booked exactly 14 days ago: today's noon already passed (15:00) -> 2 weeks later
  assert.equal(nextAutoDate(Date.UTC(2026, 9, 24, 9), NOW), noonCairo(2026, 11, 21));
  // ... but in the morning it is today at noon
  const morning = Date.UTC(2026, 10, 7, 7, 0, 0); // 09:00 Cairo
  assert.equal(nextAutoDate(Date.UTC(2026, 9, 24, 9), morning), noonCairo(2026, 11, 7));
  // missing anchor -> from now
  assert.equal(nextAutoDate(0, NOW), noonCairo(2026, 11, 21));
  // booking date in the future -> at least anchor + 14 days
  assert.equal(nextAutoDate(noonCairo(2026, 12, 1), NOW), noonCairo(2026, 12, 15));
  // always on the cycle and never before now, for many anchors
  for (let back = 0; back < 120; back++) {
    const anchor = NOW - back * DAY - 3600000 * (back % 24);
    const d = nextAutoDate(anchor, NOW);
    assert.ok(d >= NOW, `back ${back}`);
    assert.ok(d - NOW <= 15 * DAY, `back ${back} within one cycle`);
  }
});

test("a cohort booked over 3 months spreads over the next 2 weeks", async () => {
  const { nextAutoDate } = await load();
  const days = new Set();
  for (let back = 0; back < 90; back++) days.add(new Date(nextAutoDate(NOW - back * DAY, NOW)).toISOString().slice(0, 10));
  assert.ok(days.size >= 14, `spread over ${days.size} days`);
});

test("enable sets the schedule unless a person/AI date exists, and is idempotent", async () => {
  const { planEnableAutoFollowUp, AUTO_SET_VIA, AUTO_REASON } = await load();
  const p = planEnableAutoFollowUp({ status: "booked", nextFollowUpDate: 0 }, { now: NOW, anchor: NOW, by: "u1", byName: "Ali", via: "booking" }, DEL);
  assert.equal(p.autoFollowUp.enabled, true); assert.equal(p.autoFollowUp.everyDays, 14);
  assert.equal(p.autoFollowUp.startedBy, "u1"); assert.equal(p.autoFollowUp.startedVia, "booking");
  assert.equal(p.nextFollowUpDate, noonCairo(2026, 11, 21));
  assert.equal(p.nextFollowUpSetVia, AUTO_SET_VIA); assert.equal(p.nextFollowUpReason, AUTO_REASON);
  assert.equal(p.nextFollowUpReviewedBySales, DEL);
  // a manual future date stays
  const keepFuture = planEnableAutoFollowUp({ nextFollowUpDate: NOW + DAY, nextFollowUpSetVia: "manual" }, { now: NOW }, DEL);
  assert.deepEqual(Object.keys(keepFuture), ["autoFollowUp"]);
  // an AI date (even overdue) stays
  const keepAi = planEnableAutoFollowUp({ nextFollowUpDate: NOW - DAY, nextFollowUpSetVia: "ai_automation" }, { now: NOW }, DEL);
  assert.deepEqual(Object.keys(keepAi), ["autoFollowUp"]);
  // already on -> nothing
  assert.equal(planEnableAutoFollowUp({ autoFollowUp: { enabled: true } }, { now: NOW }, DEL), null);
  // a new document: no delete sentinels, no undefined values
  const created = planEnableAutoFollowUp({}, { now: NOW });
  assert.ok(!("nextFollowUpMethod" in created));
  assert.ok(Object.values(created.autoFollowUp).every((v) => v !== undefined));
});

test("disable keeps a person's date, clears only the automatic one", async () => {
  const { planDisableAutoFollowUp, planEnableAutoFollowUp } = await load();
  const on = { status: "booked", nextFollowUpDate: 0, ...planEnableAutoFollowUp({}, { now: NOW }, DEL) };
  const off = planDisableAutoFollowUp(on, { now: NOW + 1, by: "u1", byName: "Ali", reason: "استرد: رجع فلوسه", reasonCode: "استرد" }, DEL);
  assert.equal(off.autoFollowUp.enabled, false); assert.equal(off.autoFollowUp.stoppedReason, "استرد: رجع فلوسه");
  assert.equal(off.autoFollowUp.stoppedByName, "Ali"); assert.equal(off.autoFollowUp.startedAt, NOW);
  assert.equal(off.nextFollowUpDate, 0); assert.equal(off.nextFollowUpSetVia, DEL);
  const manual = planDisableAutoFollowUp({ ...on, nextFollowUpDate: NOW + DAY, nextFollowUpSetVia: "manual" }, { now: NOW, reason: "x" }, DEL);
  assert.deepEqual(Object.keys(manual), ["autoFollowUp"]);
  assert.equal(planDisableAutoFollowUp({ ...on, ...off }, { now: NOW, reason: "x" }, DEL), null);
  // re-enable starts again from now and remembers the last done date
  const again = planEnableAutoFollowUp({ ...on, ...off, autoFollowUp: { ...off.autoFollowUp, lastDoneAt: NOW - DAY } }, { now: NOW }, DEL);
  assert.equal(again.autoFollowUp.enabled, true); assert.equal(again.autoFollowUp.lastDoneAt, NOW - DAY);
  assert.equal(again.autoFollowUp.stoppedReason, undefined);
});

test("after a follow-up: next in 2 weeks unless the sales person picked a date", async () => {
  const { planAutoAfterFollowUp, manualOverridePatch } = await load();
  const on = { autoFollowUp: { enabled: true, everyDays: 14 }, nextFollowUpDate: NOW - DAY, nextFollowUpSetVia: "auto_booked" };
  const p = planAutoAfterFollowUp(on, { now: NOW }, DEL);
  assert.equal(p.autoFollowUp.lastDoneAt, NOW); assert.equal(p.nextFollowUpDate, noonCairo(2026, 11, 21));
  const m = planAutoAfterFollowUp(on, { now: NOW, manualNextTs: NOW + 3 * DAY }, DEL);
  assert.equal(m.nextFollowUpDate, undefined); assert.equal(m.autoFollowUp.lastDoneAt, NOW);
  assert.deepEqual(planAutoAfterFollowUp({ autoFollowUp: { enabled: false } }, { now: NOW }, DEL), {});
  // a contact logged later ("تم التواصل مسبقاً" 3 days ago): next = that day + 14
  const late = planAutoAfterFollowUp(on, { now: NOW, doneAt: NOW - 3 * DAY }, DEL);
  assert.equal(late.nextFollowUpDate, noonCairo(2026, 11, 18)); assert.equal(late.autoFollowUp.lastDoneAt, NOW - 3 * DAY);
  assert.deepEqual(manualOverridePatch(on, DEL), { nextFollowUpSetVia: "manual", nextFollowUpReason: DEL });
  assert.deepEqual(manualOverridePatch({ nextFollowUpSetVia: "ai_automation" }, DEL), {});
});

test("browser edits switch it on only when the client BECOMES booked", async () => {
  const { planOnBecameBooked } = await load();
  assert.ok(planOnBecameBooked({ status: "interested" }, { status: "booked" }, { now: NOW }, DEL));
  assert.ok(planOnBecameBooked({ status: "potential" }, { status: "potential", isBooked: true }, { now: NOW }, DEL));
  assert.equal(planOnBecameBooked({ status: "booked" }, { status: "booked" }, { now: NOW }, DEL), null);
  assert.equal(planOnBecameBooked({ status: "interested" }, { status: "interested" }, { now: NOW }, DEL), null);
});

test("bookingAnchor picks the newest known booking date", async () => {
  const { bookingAnchor } = await load();
  assert.equal(bookingAnchor({ bookingDate: 5, accountingLatestBookingDate: 7, accounting: { bookings: { a: { status: "ACTIVE", bookingDate: 9 }, b: { status: "REFUNDED", bookingDate: 20 } } } }), 9);
  assert.equal(bookingAnchor({}), 0);
});

// ---- accounting sync (accountingIngest + autoFollowUp, as handleAccountingIngest combines them)
const booking = (over = {}) => ({ status: "ACTIVE", bookingDate: "2026-11-01", productId: "p1", pricing: { finalPriceSnapshot: 3000 }, paymentSummary: { paidTotal: 1000, remaining: 2000 }, ...over });
const ingest = async (current, bookingId, b) => {
  const { planAccountingAutoFollowUp } = await load();
  const plan = planClientAccounting(current, summarizeBooking(bookingId, b, "كورس", NOW), NOW);
  const auto = planAccountingAutoFollowUp(current, plan.patch, { now: NOW, bookingId }, DEL);
  return { next: { ...current, ...plan.patch, ...(auto || {}), accountingBookingIds: [...new Set([...(current.accountingBookingIds || []), bookingId])] }, auto };
};

test("accounting: a new booking switches it on; repeat syncs change nothing", async () => {
  const { next, auto } = await ingest({ status: "interested", nextFollowUpDate: 0 }, "b1", booking());
  assert.equal(auto.autoFollowUp.enabled, true); assert.equal(auto.autoFollowUp.startedVia, "accounting");
  assert.equal(next.nextFollowUpSetVia, "auto_booked");
  // booked 2026-11-01 (noon Cairo) -> Nov 15
  assert.equal(next.nextFollowUpDate, noonCairo(2026, 11, 15));
  const again = await ingest(next, "b1", booking({ paymentSummary: { paidTotal: 3000, remaining: 0 } }));
  assert.equal(again.auto, null);
  assert.equal(again.next.nextFollowUpDate, next.nextFollowUpDate);
});

test("accounting: a sales person's 'off' survives payment updates, a NEW booking turns it on again", async () => {
  const { planDisableAutoFollowUp } = await load();
  const { next } = await ingest({ status: "interested", nextFollowUpDate: 0 }, "b1", booking());
  const off = { ...next, ...planDisableAutoFollowUp(next, { now: NOW, by: "u1", byName: "Ali", reason: "الكورس خلص: x" }, DEL) };
  const pay = await ingest(off, "b1", booking({ paymentSummary: { paidTotal: 3000, remaining: 0 } }));
  assert.equal(pay.auto, null); assert.equal(pay.next.autoFollowUp.enabled, false);
  const second = await ingest(off, "b2", booking({ bookingDate: "2026-11-05", productId: "p2" }));
  assert.equal(second.auto.autoFollowUp.enabled, true);
});

test("accounting: refund / delete of the last active booking switches it off", async () => {
  const { next } = await ingest({ status: "interested", nextFollowUpDate: 0 }, "b1", booking());
  const refund = await ingest(next, "b1", booking({ status: "REFUNDED" }));
  assert.equal(refund.next.status, "interested"); assert.equal(refund.next.isBooked, false);
  assert.equal(refund.auto.autoFollowUp.enabled, false);
  assert.equal(refund.auto.autoFollowUp.stoppedReason, "الحجز اتلغى أو اترد (من الحسابات)");
  assert.equal(refund.auto.autoFollowUp.stoppedByName, "نظام الحسابات");
  assert.equal(refund.next.nextFollowUpDate, 0); assert.equal(refund.next.nextFollowUpSetVia, DEL);
  // replayed refund: nothing more
  const replay = await ingest(refund.next, "b1", booking({ status: "REFUNDED" }));
  assert.equal(replay.auto, null);
  // one of two bookings refunded: still booked, stays on
  const two = await ingest(next, "b2", booking({ bookingDate: "2026-11-03", productId: "p2" }));
  const partial = await ingest(two.next, "b1", booking({ status: "REFUNDED" }));
  assert.equal(partial.next.isBooked, true); assert.equal(partial.auto, null);
});

test("accounting: old bookings (over 90 days) are not switched on; a manual date is kept", async () => {
  const old = await ingest({ status: "interested" }, "b1", booking({ bookingDate: "2026-06-01" }));
  assert.equal(old.auto, null);
  const manual = await ingest({ status: "interested", nextFollowUpDate: NOW + DAY, nextFollowUpSetVia: "manual" }, "b1", booking());
  assert.equal(manual.auto.autoFollowUp.enabled, true);
  assert.equal(manual.next.nextFollowUpDate, NOW + DAY); assert.equal(manual.next.nextFollowUpSetVia, "manual");
});

test("accounting: a client created from a booking starts with the automatic follow-up", async () => {
  const { planAccountingAutoFollowUp } = await load();
  const summary = summarizeBooking("b1", booking(), "C", NOW);
  const created = newClientFromBooking({ name: "منى", phone: "01012345678" }, summary, { id: "u1", name: "Pool" }, NOW);
  const auto = planAccountingAutoFollowUp({}, created, { now: NOW, bookingId: "b1" });
  const doc = { ...created, ...auto };
  assert.equal(doc.autoFollowUp.enabled, true);
  assert.equal(doc.nextFollowUpDate, noonCairo(2026, 11, 15));
  assert.ok(!Object.values(doc).includes(undefined));
  assert.ok(!("nextFollowUpMethod" in doc)); // no delete sentinel in a new document
});
