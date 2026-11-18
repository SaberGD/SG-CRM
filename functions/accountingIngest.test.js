const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePhoneKey, customerPhoneKeys, summarizeBooking, planClientAccounting, newClientFromBooking } = require("./accountingIngest");

const booking = (over = {}) => ({ status: "ACTIVE", bookingDate: "2026-10-01", productId: "p1", productType: "course", pricing: { finalPriceSnapshot: 3250 }, paymentSummary: { paidTotal: 800, remaining: 2450, next_due_date: "2026-11-01" }, salesName: "Agent One", ...over });

test("phone keys unify formats and use phone AND whatsapp", () => {
  assert.equal(normalizePhoneKey("+20 101 234 5678"), "1012345678");
  assert.equal(normalizePhoneKey("01012345678"), "1012345678");
  assert.equal(normalizePhoneKey("123"), "");
  assert.deepEqual(customerPhoneKeys({ phone: "01012345678", whatsapp: "1099999999", fullWhatsapp: "+201099999999" }).sort(), ["1012345678", "1099999999"].sort());
});

test("a booking makes the client booked with accounting money", () => {
  const s = summarizeBooking("b1", booking(), "كورس الجرافيك", 1000);
  const { patch, changedFields, overwroteFinancials } = planClientAccounting({ status: "interested", paidAmount: 0 }, s, 1000);
  assert.equal(patch.status, "booked"); assert.equal(patch.isBooked, true);
  assert.equal(patch.paidAmount, 800); assert.equal(patch.totalPrice, 3250); assert.equal(patch.remainingAmount, 2450);
  assert.equal(patch.bookedCourseName, "كورس الجرافيك");
  assert.ok(changedFields.includes("paidAmount"));
  assert.equal(overwroteFinancials, false);
});

test("later payment updates the same booking; manual wrong money is overwritten and flagged", () => {
  const first = planClientAccounting({ status: "booked", paidAmount: 800, totalPrice: 3250 }, summarizeBooking("b1", booking(), "C", 1), 1).patch;
  const second = planClientAccounting({ ...first, status: "booked", paidAmount: 500 }, summarizeBooking("b1", booking({ paymentSummary: { paidTotal: 3250, remaining: 0 } }), "C", 2), 2);
  assert.equal(second.patch.paidAmount, 3250); assert.equal(second.patch.remainingAmount, 0);
  assert.equal(Object.keys(second.patch.accounting.bookings).length, 1);
  assert.equal(second.overwroteFinancials, true);
});

test("two active bookings add up", () => {
  const a = planClientAccounting({}, summarizeBooking("b1", booking(), "A", 1), 1).patch;
  const b = planClientAccounting(a, summarizeBooking("b2", booking({ bookingDate: "2026-10-20", productId: "p2", pricing: { finalPriceSnapshot: 2000 }, paymentSummary: { paidTotal: 2000, remaining: 0 } }), "B", 2), 2).patch;
  assert.equal(b.totalPrice, 5250); assert.equal(b.paidAmount, 2800); assert.equal(b.bookedCourseName, "B");
  assert.equal(b.accounting.activeCount, 2);
});

test("refund or cancellation takes the client out of booked, keeps history", () => {
  const a = planClientAccounting({}, summarizeBooking("b1", booking(), "A", 1), 1).patch;
  const r = planClientAccounting({ ...a }, summarizeBooking("b1", booking({ status: "REFUNDED", refundedTotal: 800 }), "A", 2), 2).patch;
  assert.equal(r.isBooked, false); assert.equal(r.status, "interested"); assert.equal(r.paidAmount, 0);
  assert.equal(r.accounting.bookings.b1.status, "REFUNDED"); assert.equal(r.accounting.bookings.b1.refundedTotal, 800);
  const d = summarizeBooking("b9", booking({ isDeleted: true }), "A", 3);
  assert.equal(d.status, "DELETED");
});

test("a new client can be built from a booking nobody had", () => {
  const c = newClientFromBooking({ name: "منى", phone: "01012345678", countryCode: "+20" }, summarizeBooking("b1", booking(), "C", 1), { id: "u1", name: "Pool" }, 5);
  assert.equal(c.createdVia, "accounting_sync"); assert.equal(c.phoneKey, "1012345678"); assert.equal(c.isBooked, true); assert.equal(c.paidAmount, 800);
});

test("activeBookingsCount / multiCourse follow the ACTIVE bookings only", () => {
  const one = planClientAccounting({}, summarizeBooking("b1", booking(), "A", 1), 1).patch;
  assert.equal(one.activeBookingsCount, 1); assert.equal(one.multiCourse, false);
  const two = planClientAccounting({ accounting: { bookings: one.accounting.bookings } }, summarizeBooking("b2", booking({ productId: "p2" }), "B", 2), 2).patch;
  assert.equal(two.activeBookingsCount, 2); assert.equal(two.multiCourse, true);
  const refunded = planClientAccounting({ accounting: { bookings: two.accounting.bookings } }, summarizeBooking("b2", booking({ status: "REFUNDED" }), "B", 3), 3).patch;
  assert.equal(refunded.activeBookingsCount, 1); assert.equal(refunded.multiCourse, false);
  const none = planClientAccounting({ accounting: { bookings: one.accounting.bookings } }, summarizeBooking("b1", booking({ status: "REFUNDED" }), "A", 4), 4).patch;
  assert.equal(none.activeBookingsCount, 0); assert.equal(none.multiCourse, false);
});

const { timeMs, sourceUpdatedAtMs, isStaleSummary, accountingClientId } = require("./accountingIngest");

test("accounting times are read from every shape they can arrive in", () => {
  const ms = Date.parse("2026-11-10T10:00:00Z");
  assert.equal(timeMs(ms), ms);
  assert.equal(timeMs(ms / 1000), ms);                       // seconds
  assert.equal(timeMs(String(ms)), ms);                      // numeric string
  assert.equal(timeMs("2026-11-10T10:00:00Z"), ms);          // ISO
  assert.equal(timeMs({ seconds: ms / 1000, nanoseconds: 0 }), ms);
  assert.equal(timeMs({ _seconds: ms / 1000, _nanoseconds: 5e6 }), ms + 5);
  assert.equal(timeMs({ toMillis: () => ms }), ms);
  for (const bad of [undefined, null, "", "not a date", -5, NaN, {}, []]) assert.equal(timeMs(bad), 0);
});

test("the booking's own updated time goes into the summary as sourceUpdatedAt", () => {
  assert.equal(sourceUpdatedAtMs({ updatedAtMs: 2000000000000 }), 2000000000000);
  assert.equal(sourceUpdatedAtMs({ updatedAt: { _seconds: 1800000000 } }), 1800000000000);
  assert.equal(sourceUpdatedAtMs({ lastModified: "2026-11-10T10:00:00Z" }), Date.parse("2026-11-10T10:00:00Z"));
  assert.equal(sourceUpdatedAtMs({}), 0);
  assert.equal(summarizeBooking("b1", booking({ updatedAt: { seconds: 1800000000 } }), "C", 1).sourceUpdatedAt, 1800000000000);
  assert.equal(summarizeBooking("b1", booking(), "C", 1).sourceUpdatedAt, 0);
});

test("an older payload than the stored one is stale; equal, newer or untimed is not", () => {
  const stored = planClientAccounting({}, summarizeBooking("b1", booking({ updatedAtMs: 2000 * 1e9 }), "C", 1), 1).patch;
  const older = summarizeBooking("b1", booking({ updatedAtMs: 1999 * 1e9, paymentSummary: { paidTotal: 0 } }), "C", 2);
  const same = summarizeBooking("b1", booking({ updatedAtMs: 2000 * 1e9 }), "C", 2);
  const newer = summarizeBooking("b1", booking({ updatedAtMs: 2001 * 1e9 }), "C", 2);
  const untimed = summarizeBooking("b1", booking(), "C", 2);
  assert.equal(isStaleSummary(stored, older), true);
  assert.equal(isStaleSummary(stored, same), false);
  assert.equal(isStaleSummary(stored, newer), false);
  assert.equal(isStaleSummary(stored, untimed), false);
  // a different booking or a client with no stored time is never stale
  assert.equal(isStaleSummary(stored, summarizeBooking("b2", booking({ updatedAtMs: 1 * 1e12 }), "C", 2)), false);
  assert.equal(isStaleSummary({}, older), false);
});

test("clients created from accounting get a deterministic id", () => {
  assert.equal(accountingClientId("cust_123", "1012345678"), "acc_cust_123");
  assert.equal(accountingClientId("", "1012345678"), "acc_pk_1012345678");
  assert.equal(accountingClientId("bad/id", "1012345678"), "acc_pk_1012345678");
  assert.equal(accountingClientId(undefined, ""), "");
});
