const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePhoneKey, customerPhoneKeys, summarizeBooking, planClientAccounting, newClientFromBooking } = require("./accountingIngest");

const booking = (over = {}) => ({ status: "ACTIVE", bookingDate: "2026-10-01", productId: "p1", productType: "course", pricing: { finalPriceSnapshot: 3250 }, paymentSummary: { paidTotal: 800, remaining: 2450, next_due_date: "2026-11-01" }, salesName: "Alyaa", ...over });

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
