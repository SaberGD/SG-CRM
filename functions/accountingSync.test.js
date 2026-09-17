const assert = require("node:assert/strict");
const test = require("node:test");
const { planAccountingBookingSync } = require("./accountingSync");

const booking = {
  bookingDate: "2026-09-17",
  productId: "course-1",
  pricing: { finalPriceSnapshot: 4500 },
  paymentSummary: { paidTotal: 800, remaining: 3700 },
};

test("accounting values replace provisional CRM financials with an audit snapshot", () => {
  const plan = planAccountingBookingSync({
    status: "booked", isBooked: true, totalPrice: 6000, paidAmount: 1000,
    remainingAmount: 5000, bookedCourseName: "Old course",
  }, booking, "New course");

  assert.equal(plan.applied.totalPrice, 4500);
  assert.equal(plan.applied.paidAmount, 800);
  assert.equal(plan.applied.remainingAmount, 3700);
  assert.equal(plan.previous.totalPrice, 6000);
  assert.deepEqual(plan.overwrittenFinancialFields, ["totalPrice", "paidAmount", "remainingAmount"]);
  assert.equal(plan.applied.bookedCourseName, "New course");
});

test("older bookings are linked without replacing newer booking fields", () => {
  const plan = planAccountingBookingSync({ accountingLatestBookingDate: Date.parse("2026-09-18T12:00:00+03:00") }, booking, "Course");
  assert.equal(plan.isLatestBooking, false);
  assert.deepEqual(plan.changedFields, []);
});

test("invalid financial snapshots never become zero-valued CRM bookings", () => {
  assert.throws(() => planAccountingBookingSync({}, { ...booking, pricing: {} }, "Course"), RangeError);
  assert.throws(() => planAccountingBookingSync({}, { ...booking, paymentSummary: { paidTotal: -1, remaining: 4500 } }, "Course"), RangeError);
  assert.throws(() => planAccountingBookingSync({}, { ...booking, paymentSummary: { paidTotal: 800, remaining: 4000 } }, "Course"), RangeError);
  assert.throws(() => planAccountingBookingSync({}, { ...booking, bookingDate: "2026-02-31" }, "Course"), RangeError);
});
