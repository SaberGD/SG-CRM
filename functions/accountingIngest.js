// Accounting -> CRM sync (pure logic). The accounting system is the source of truth for
// bookings and money; this keeps each CRM client's booking status and financials in step.

const normalizePhoneKey = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-10) : "";
};

// Every number the customer has (phone and WhatsApp) -> keys to look up in the CRM.
function customerPhoneKeys(customer) {
  const keys = [customer?.phone, customer?.whatsapp, customer?.fullWhatsapp].map(normalizePhoneKey).filter(Boolean);
  return [...new Set(keys)];
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function bookingDateMs(booking) {
  const d = String(booking.bookingDate || "");
  const t = /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T12:00:00+03:00`) : NaN;
  return Number.isFinite(t) ? t : 0;
}

// One compact record per accounting booking, stored under client.accounting.bookings[bookingId].
function summarizeBooking(bookingId, booking, productName, now) {
  const inactive = booking.isDeleted === true || booking.status !== "ACTIVE";
  const total = num(booking.pricing?.finalPriceSnapshot);
  const paid = num(booking.paymentSummary?.paidTotal);
  return {
    id: bookingId,
    status: inactive ? (booking.status === "REFUNDED" ? "REFUNDED" : booking.isDeleted ? "DELETED" : booking.status || "DEACTIVATED") : "ACTIVE",
    courseName: String(productName || ""),
    productId: String(booking.productId || ""),
    productType: String(booking.productType || ""),
    bookingDate: bookingDateMs(booking),
    total,
    paid,
    remaining: Math.max(0, num(booking.paymentSummary?.remaining ?? total - paid)),
    nextDueDate: booking.paymentSummary?.next_due_date || null,
    refundedTotal: num(booking.refundedTotal),
    accountingSalesName: String(booking.salesName || ""),
    updatedAt: now,
  };
}

/**
 * current: the CRM client doc data. Returns the fields to write.
 * Money is the SUM over the client's ACTIVE accounting bookings; if none is active
 * (cancelled / refunded) the client leaves "booked" so the pipeline is honest.
 */
function planClientAccounting(current, summary, now = Date.now()) {
  const bookings = { ...(current.accounting?.bookings || {}), [summary.id]: summary };
  const active = Object.values(bookings).filter((b) => b.status === "ACTIVE");
  const totals = active.reduce((t, b) => ({ total: t.total + b.total, paid: t.paid + b.paid, remaining: t.remaining + b.remaining }), { total: 0, paid: 0, remaining: 0 });
  const latest = active.reduce((a, b) => (!a || b.bookingDate >= a.bookingDate ? b : a), null);

  const patch = {
    accounting: { bookings, totals, activeCount: active.length, lastSyncedAt: now },
    accountingLastSyncedAt: now,
  };
  if (latest) {
    Object.assign(patch, {
      status: "booked", isBooked: true,
      bookedCourseId: latest.productId, bookedCourseName: latest.courseName || current.bookedCourseName || current.serviceName || "",
      totalPrice: totals.total, paidAmount: totals.paid, remainingAmount: totals.remaining,
      bookingDate: latest.bookingDate, accountingLatestBookingDate: latest.bookingDate,
    });
  } else {
    Object.assign(patch, { isBooked: false, totalPrice: 0, paidAmount: 0, remainingAmount: 0 });
    if (current.status === "booked") patch.status = "interested";
  }
  const FIELDS = ["status", "isBooked", "bookedCourseName", "totalPrice", "paidAmount", "remainingAmount"];
  const previous = Object.fromEntries(FIELDS.map((f) => [f, current[f] ?? null]));
  const changedFields = FIELDS.filter((f) => f in patch && previous[f] !== patch[f]);
  const overwroteFinancials = changedFields.some((f) => ["totalPrice", "paidAmount", "remainingAmount"].includes(f) && previous[f] !== null && previous[f] !== 0);
  return { patch, previous, changedFields, overwroteFinancials };
}

// New CRM client created from a booking nobody had in the CRM yet.
function newClientFromBooking(customer, summary, agent, now = Date.now()) {
  const key = normalizePhoneKey(customer.fullWhatsapp || customer.whatsapp || customer.phone) || normalizePhoneKey(customer.phone);
  const base = {
    name: String(customer.name || "عميل من الحسابات"),
    phone: String(customer.fullWhatsapp || customer.whatsapp || customer.phone || ""),
    phoneKey: key, phoneKeys: customerPhoneKeys(customer),
    gender: "unspecified", laptop: "unspecified", mode: "unspecified",
    serviceId: "", serviceName: summary.courseName || "", labels: [],
    salesAgentId: agent?.id || "", salesAgentName: agent?.name || "",
    createdAt: now, country: "مصر", countryCode: customer.countryCode || "+20",
    source: "other", createdVia: "accounting_sync",
    nextFollowUpDate: 0, // "no date yet": a missing field cannot be queried
    notes: `تم إنشاء العميل تلقائياً من حجز في نظام الحسابات (${summary.accountingSalesName || "—"})`,
  };
  return { ...base, ...planClientAccounting({}, summary, now).patch };
}

module.exports = { normalizePhoneKey, customerPhoneKeys, summarizeBooking, planClientAccounting, newClientFromBooking, bookingDateMs };
