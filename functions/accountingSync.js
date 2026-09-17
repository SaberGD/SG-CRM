const FINANCIAL_FIELDS = ["totalPrice", "paidAmount", "remainingAmount"];

function planAccountingBookingSync(current, booking, productName) {
  const price = booking.pricing?.finalPriceSnapshot;
  const paid = booking.paymentSummary?.paidTotal;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0 ||
      typeof paid !== "number" || !Number.isFinite(paid) || paid < 0) {
    throw new RangeError("Booking financials are missing or invalid");
  }
  const remaining = booking.paymentSummary?.remaining;
  if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0 ||
      Math.abs(remaining - Math.max(0, price - paid)) > 0.01) {
    throw new RangeError("Booking balance does not match price and payments");
  }

  const bookingDate = String(booking.bookingDate || "");
  const bookedAt = /^\d{4}-\d{2}-\d{2}$/.test(bookingDate)
    ? Date.parse(`${bookingDate}T12:00:00+03:00`)
    : NaN;
  if (!Number.isFinite(bookedAt) || new Date(bookedAt).toISOString().slice(0, 10) !== bookingDate) {
    throw new RangeError("Booking date is invalid");
  }

  const isLatestBooking = bookedAt >= (current.accountingLatestBookingDate || 0);
  const applied = {
    status: "booked",
    isBooked: true,
    bookedCourseId: String(booking.productId || ""),
    bookedCourseName: String(productName || current.bookedCourseName || current.serviceName || ""),
    totalPrice: price,
    paidAmount: paid,
    remainingAmount: remaining,
    bookingDate: bookedAt,
    accountingLatestBookingDate: bookedAt,
  };
  const previous = Object.fromEntries(Object.keys(applied).map((key) => [key, current[key] ?? null]));
  const changedFields = isLatestBooking
    ? Object.keys(applied).filter((key) => previous[key] !== applied[key])
    : [];
  const overwrittenFinancialFields = changedFields.filter((key) =>
    FINANCIAL_FIELDS.includes(key) && previous[key] !== null);

  return { isLatestBooking, applied, previous, changedFields, overwrittenFinancialFields };
}

module.exports = { planAccountingBookingSync };
