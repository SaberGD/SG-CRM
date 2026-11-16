// Client 360: merge the accounting bookings with the training students and work out where the
// client is in the course lifecycle. Pure functions (no I/O) so they are unit-tested.
// Dates are "YYYY-MM-DD" strings (Cairo calendar days); comparing them as strings is safe.

const ALUMNI_AFTER_DAYS = 7;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (s) => typeof s === "string" && DATE_RE.test(s);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Today in Cairo as YYYY-MM-DD.
function cairoToday(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * accounting: the accounting endpoint response (or null when that system was down)
 * training:   the training endpoint response (or null)
 * Returns one row per accounting booking, then one per training student with no booking.
 * A course row is only trusted as "active" when accounting says ACTIVE (or accounting is missing).
 */
function buildCourses(accounting, training) {
  const students = Array.isArray(training?.students) ? training.students : [];
  const bookings = Array.isArray(accounting?.bookings) ? accounting.bookings : [];
  const bySource = new Map();
  for (const s of students) if (s?.sourceBookingId && !bySource.has(s.sourceBookingId)) bySource.set(s.sourceBookingId, s);
  const used = new Set();
  const courses = [];

  for (const b of bookings) {
    const st = bySource.get(b.id) || null;
    if (st) used.add(st.sourceBookingId);
    courses.push({
      bookingId: b.id || "",
      name: String(b.productName || st?.courseName || ""),
      productType: b.productType || "",
      status: b.status || "UNKNOWN",
      startDate: isDay(st?.startDate) ? st.startDate : isDay(b.group?.startDate) ? b.group.startDate : "",
      endDate: isDay(st?.endDate) ? st.endDate : "",
      groupName: String(st?.groupName || b.group?.name || ""),
      paid: num(b.paid), remaining: num(b.remaining), finalPrice: num(b.pricing?.finalPrice),
      nextDue: isDay(b.nextDue?.date) ? b.nextDue.date : "",
      nextDueAmount: num(b.nextDue?.amount),
      hasTraining: !!st,
    });
  }
  // Students the accounting side did not return: shown, and counted as active only when
  // accounting gave us nothing at all (so a refunded booking can never keep a client "running").
  const accountingUsable = !!accounting && accounting.found !== false;
  for (const s of students) {
    if (s?.sourceBookingId && used.has(s.sourceBookingId)) continue;
    courses.push({
      bookingId: s?.sourceBookingId || "",
      name: String(s?.courseName || ""),
      productType: "",
      status: accountingUsable ? "UNMATCHED" : "ACTIVE",
      startDate: isDay(s?.startDate) ? s.startDate : "",
      endDate: isDay(s?.endDate) ? s.endDate : "",
      groupName: String(s?.groupName || ""),
      paid: 0, remaining: 0, finalPrice: 0, nextDue: "", nextDueAmount: 0, hasTraining: true,
    });
  }
  return courses;
}

/**
 * courseEndsAt = latest end date among ACTIVE courses; alumniFrom = that + 7 days.
 * Anything we cannot be sure about is "unknown": a wrong "alumni" prompt is worse than none.
 */
function computeLifecycle(courses, now = Date.now()) {
  const today = cairoToday(now);
  const active = (courses || []).filter((c) => c.status === "ACTIVE");
  const none = { courseEndsAt: null, alumniFrom: null, state: "unknown" };
  if (!active.length) return none;
  const ends = active.map((c) => c.endDate).filter(isDay);
  const starts = active.map((c) => c.startDate).filter(isDay);
  const courseEndsAt = ends.length ? ends.reduce((a, b) => (b > a ? b : a)) : null;

  // Some active course has no known end: only say "not started" if every one of them is in the future.
  if (ends.length < active.length) {
    const allFuture = starts.length === active.length && starts.every((s) => s > today);
    return { courseEndsAt: null, alumniFrom: null, state: allFuture ? "before_start" : "unknown" };
  }
  const alumniFrom = addDays(courseEndsAt, ALUMNI_AFTER_DAYS);
  const firstStart = starts.length ? starts.reduce((a, b) => (b < a ? b : a)) : null;
  let state;
  if (today >= alumniFrom) state = "alumni_due";
  else if (today > courseEndsAt) state = "finished";
  else if (firstStart && today < firstStart) state = "before_start";
  else state = "running";
  return { courseEndsAt, alumniFrom, state };
}

module.exports = { ALUMNI_AFTER_DAYS, cairoToday, addDays, buildCourses, computeLifecycle };
