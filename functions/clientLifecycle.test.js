const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCourses, computeLifecycle, addDays, cairoToday } = require("./clientLifecycle");

const at = (day) => Date.parse(`${day}T12:00:00+02:00`);
const acc = (bookings) => ({ found: true, bookings });
const bk = (id, over = {}) => ({ id, status: "ACTIVE", productName: `course ${id}`, productType: "course", group: { name: "G", startDate: "2026-11-01" }, paid: 1000, remaining: 500, pricing: { finalPrice: 1500 }, nextDue: { date: "2026-12-01", amount: 500 }, ...over });
const st = (id, over = {}) => ({ sourceBookingId: id, groupName: "Grp", courseName: `course ${id}`, startDate: "2026-11-01", endDate: "2026-12-01", ...over });

test("date helpers", () => {
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
  assert.equal(cairoToday(Date.parse("2026-11-16T22:30:00Z")), "2026-11-17"); // already after midnight in Cairo
});

test("merges bookings with training students by sourceBookingId", () => {
  const courses = buildCourses(acc([bk("b1"), bk("b2", { status: "REFUNDED" })]), { students: [st("b1")] });
  assert.equal(courses.length, 2);
  assert.deepEqual([courses[0].bookingId, courses[0].endDate, courses[0].hasTraining, courses[0].nextDue], ["b1", "2026-12-01", true, "2026-12-01"]);
  assert.equal(courses[1].status, "REFUNDED"); assert.equal(courses[1].hasTraining, false);
});

test("a training student without a booking is UNMATCHED when accounting answered, ACTIVE when it did not", () => {
  assert.equal(buildCourses(acc([]), { students: [st("x")] })[0].status, "UNMATCHED");
  assert.equal(buildCourses(null, { students: [st("x")] })[0].status, "ACTIVE");
});

test("lifecycle states", () => {
  const c = (over) => buildCourses(acc([bk("b1")]), { students: [st("b1", over)] });
  assert.equal(computeLifecycle(c({}), at("2026-10-20")).state, "before_start");
  assert.equal(computeLifecycle(c({}), at("2026-11-15")).state, "running");
  assert.equal(computeLifecycle(c({}), at("2026-12-01")).state, "running"); // last day
  assert.equal(computeLifecycle(c({}), at("2026-12-05")).state, "finished");
  const due = computeLifecycle(c({}), at("2026-12-08"));
  assert.deepEqual(due, { courseEndsAt: "2026-12-01", alumniFrom: "2026-12-08", state: "alumni_due" });
});

test("courseEndsAt is the latest end among ACTIVE bookings; refunded ones are ignored", () => {
  const courses = buildCourses(acc([bk("b1"), bk("b2"), bk("b3", { status: "REFUNDED" })]), {
    students: [st("b1", { endDate: "2026-11-10" }), st("b2", { endDate: "2026-12-20" }), st("b3", { endDate: "2027-03-01" })],
  });
  const lc = computeLifecycle(courses, at("2026-12-01"));
  assert.equal(lc.courseEndsAt, "2026-12-20"); assert.equal(lc.state, "running");
});

test("unknown when nothing is active, or an active course has no end date", () => {
  assert.equal(computeLifecycle([], at("2026-12-01")).state, "unknown");
  assert.equal(computeLifecycle(buildCourses(acc([bk("b1", { status: "REFUNDED" })]), { students: [st("b1")] }), at("2027-01-01")).state, "unknown");
  // accounting only (training down): no end date => never "alumni_due"
  assert.equal(computeLifecycle(buildCourses(acc([bk("b1", { group: { startDate: "2026-01-01" } })]), null), at("2027-06-01")).state, "unknown");
  // one finished course but a second one with no end date yet must not prompt alumni
  const mixed = buildCourses(acc([bk("b1"), bk("b2")]), { students: [st("b1", { endDate: "2026-01-10" })] });
  assert.equal(computeLifecycle(mixed, at("2026-12-01")).state, "unknown");
});

test("accounting only with a future group start is before_start", () => {
  const c = buildCourses(acc([bk("b1", { group: { startDate: "2027-01-10" } })]), null);
  assert.equal(computeLifecycle(c, at("2026-12-01")).state, "before_start");
});
