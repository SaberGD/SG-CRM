const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./automationUpsert");

const NOW = Date.parse("2026-11-18T10:00:00Z");
const DAY = 24 * 3600 * 1000;

test("validation: object body, types, hard limits", () => {
  assert.equal(A.validateAutomationBody({ customer_name: "Mona", customer_phone: 1012345678 }), null);
  assert.match(A.validateAutomationBody(null), /object/);
  assert.match(A.validateAutomationBody([]), /object/);
  assert.match(A.validateAutomationBody({ customer_name: { $gt: "" } }), /customer_name must be a string/);
  assert.match(A.validateAutomationBody({ customer_name: 5 }), /customer_name must be a string/);
  assert.match(A.validateAutomationBody({ sales_brief: "x".repeat(20001) }), /too long/);
  assert.match(A.validateAutomationBody({ suggested_labels: "vip" }), /must be an array/);
  assert.match(A.validateAutomationBody({ suggested_labels: Array(101).fill("a") }), /too many/);
  assert.match(A.validateAutomationBody({ suggested_labels: [{}] }), /short strings/);
  assert.match(A.validateAutomationBody({ has_meaningful_content: {} }), /boolean/);
  assert.match(A.validateAutomationBody({ junk: "x".repeat(100001) }), /too large/);
});

test("sanitize: every field is cut to its limit, unknown fields are dropped", () => {
  const out = A.sanitizeAutomationBody({
    customer_name: "  N".padEnd(300, "a"),
    sales_brief: "line1\n\n\n\nline2 " + "b".repeat(3000),
    detailed_result: "r".repeat(2500),
    profile_link: "https://example.invalid/" + "p".repeat(600),
    suggested_labels: Array.from({ length: 30 }, (_, i) => `label ${i} `.padEnd(80, "z")),
    automationSecret: "must not survive",
    random_field: "dropped",
    country_code: "20",
    customer_phone: 1012345678,
  });
  assert.equal(out.customer_name.length, 120);
  assert.ok(out.sales_brief.startsWith("line1\n\nline2"));
  assert.equal(out.sales_brief.length, 2000);
  assert.equal(out.detailed_result.length, 2000);
  assert.equal(out.profile_link.length, 500);
  assert.equal(out.suggested_labels.length, 20);
  assert.ok(out.suggested_labels.every((l) => l.length <= 60));
  assert.equal("automationSecret" in out, false);
  assert.equal("random_field" in out, false);
  assert.equal(out.country_code, "+20");
  assert.equal(out.customer_phone, 1012345678);
  assert.equal(A.sanitizeAutomationBody({ country_code: "egypt" }).country_code, undefined);
  assert.equal(A.sanitizeAutomationBody({ has_meaningful_content: "false" }).has_meaningful_content, false);
});

test("ad code: 1-3 letters + 1-4 digits after trim/uppercase, else ignored", () => {
  assert.equal(A.parseAdCode(" n12 "), "N12");
  assert.equal(A.parseAdCode("F3"), "F3");
  assert.equal(A.parseAdCode("ABC1234"), "ABC1234");
  for (const bad of ["", "12", "N", "ABCD1", "N12345", "N-12", "ن12", null, 12, "N12 hello"]) assert.equal(A.parseAdCode(bad), "");
});

test("first touch wins: adCode / firstMessageAt only when the client has none", () => {
  assert.deepEqual(A.firstTouchFields(null, { adCode: "N1", firstMessageAt: NOW }), { adCode: "N1", firstMessageAt: NOW });
  assert.deepEqual(A.firstTouchFields({ adCode: "O2" }, { adCode: "N1", firstMessageAt: NOW }), { firstMessageAt: NOW });
  assert.deepEqual(A.firstTouchFields({ adCode: "O2", firstMessageAt: 5 }, { adCode: "N1", firstMessageAt: NOW }), {});
  assert.deepEqual(A.firstTouchFields({}, { adCode: "", firstMessageAt: 0 }), {});
  assert.equal(A.followUpAdCode({ adCode: "O2" }, "N1"), "N1");
  assert.equal(A.followUpAdCode({ adCode: "O2" }, ""), "O2");
  assert.equal(A.followUpAdCode({}, ""), null);
});

test("timestamps: seconds, ms, ISO; absurd values are 0", () => {
  assert.equal(A.parseTimestamp(NOW / 1000, NOW), NOW);
  assert.equal(A.parseTimestamp(NOW, NOW), NOW);
  assert.equal(A.parseTimestamp(String(NOW), NOW), NOW);
  assert.equal(A.parseTimestamp("2026-11-18T10:00:00Z", NOW), NOW);
  assert.equal(A.parseTimestamp("1999-01-01", NOW), 0);
  assert.equal(A.parseTimestamp(NOW + 5 * DAY, NOW), 0);
  assert.equal(A.parseTimestamp("soon", NOW), 0);
  assert.equal(A.parseTimestamp(undefined, NOW), 0);
});

test("status: interested never becomes potential; booked / not_interested never touched", () => {
  assert.deepEqual(A.decideAutomationStatus(null, "interested"), { status: "interested", bookedMentioned: false });
  assert.deepEqual(A.decideAutomationStatus(null, "booked"), { status: "potential", bookedMentioned: true });
  assert.deepEqual(A.decideAutomationStatus(null, "whatever"), { status: "potential", bookedMentioned: false });
  assert.equal(A.decideAutomationStatus({ status: "interested" }, "potential").status, null);
  assert.equal(A.decideAutomationStatus({ status: "interested" }, "not_interested").status, null);
  assert.equal(A.decideAutomationStatus({ status: "interested" }, "booked").bookedMentioned, true);
  assert.equal(A.decideAutomationStatus({ status: "booked" }, "interested").status, null);
  assert.equal(A.decideAutomationStatus({ status: "potential", isBooked: true }, "interested").status, null);
  assert.equal(A.decideAutomationStatus({ status: "not_interested" }, "interested").status, null);
  assert.equal(A.decideAutomationStatus({ status: "potential" }, "interested").status, "interested");
  assert.equal(A.decideAutomationStatus({ status: "potential" }, "not_interested").status, "not_interested");
  assert.equal(A.decideAutomationStatus({ status: "potential" }, "potential").status, null);
  assert.equal(A.decideAutomationStatus({}, "interested").status, "interested");
});

test("follow-up date: only an explicit future date sets nextFollowUpDate", () => {
  const future = new Date(NOW + 2 * DAY).toISOString();
  const explicit = A.planAutomationFollowUpDate({ body: { next_followup_date: future, next_followup_reason: " asked " }, method: "phone", now: NOW });
  assert.equal(explicit.explicitFuture, true);
  assert.equal(explicit.suggestion, null);
  assert.deepEqual(explicit.set, { nextFollowUpDate: NOW + 2 * DAY, nextFollowUpMethod: "phone", nextFollowUpSetVia: "ai_automation", nextFollowUpReason: "asked", nextFollowUpReviewedBySales: false });

  const suggested = A.planAutomationFollowUpDate({ body: { next_followup_date: future, missing_or_ambiguous_fields: ["next_followup_date_suggested_not_explicit"] }, method: "whatsapp", now: NOW });
  assert.equal(suggested.set, null);
  assert.deepEqual(suggested.suggestion.automationSuggestedFollowUp, { at: NOW + 2 * DAY, channel: "whatsapp", reason: "suggested", note: "", receivedAt: NOW });

  const past = A.planAutomationFollowUpDate({ body: { next_followup_date: new Date(NOW - DAY).toISOString() }, method: "phone", now: NOW });
  assert.equal(past.set, null);
  assert.equal(past.suggestion.automationSuggestedFollowUp.reason, "past");

  const now = A.planAutomationFollowUpDate({ body: { next_followup_date: NOW }, method: "phone", now: NOW });
  assert.equal(now.set, null, "a date equal to now is not in the future");

  assert.deepEqual(A.planAutomationFollowUpDate({ body: {}, method: "phone", now: NOW }), { set: null, suggestion: null, explicitFuture: false });
  assert.deepEqual(A.planAutomationFollowUpDate({ body: { next_followup_date: "garbage" }, method: "phone", now: NOW }), { set: null, suggestion: null, explicitFuture: false });
});

test("dedupe: oldest client wins, ambiguity is reported, nothing when empty", () => {
  assert.equal(A.pickDedupeMatch([]), null);
  const one = A.pickDedupeMatch([{ id: "a", data: { createdAt: 5 } }]);
  assert.equal(one.pick.id, "a"); assert.equal(one.ambiguous, false);
  const many = A.pickDedupeMatch([{ id: "z", data: { createdAt: 9 } }, { id: "y", data: { createdAt: 3 } }, { id: "x", data: {} }]);
  assert.equal(many.pick.id, "y"); assert.equal(many.ambiguous, true); assert.deepEqual(many.candidateIds, ["y", "z", "x"]);
  const tie = A.pickDedupeMatch([{ id: "b", data: { createdAt: 3 } }, { id: "a", data: { createdAt: 3 } }]);
  assert.equal(tie.pick.id, "a", "same createdAt -> lowest id, so the pick is stable");
});

test("phoneKey backfill for legacy clients", () => {
  assert.deepEqual(A.phoneKeyBackfill({}, "1012345678"), { phoneKey: "1012345678", phoneKeys: ["1012345678"] });
  assert.deepEqual(A.phoneKeyBackfill({ phoneKey: "1012345678", phoneKeys: ["1012345678"] }, "1012345678"), {});
  assert.deepEqual(A.phoneKeyBackfill({ phoneKey: "1099999999" }, "1012345678"), { phoneKeys: ["1099999999", "1012345678"] });
  assert.deepEqual(A.phoneKeyBackfill({}, ""), {});
});

test("phones normalise like the add-client screen", () => {
  assert.equal(A.normalizeIncomingPhone("01012345678", "+20"), "+201012345678");
  assert.equal(A.normalizeIncomingPhone("+20 101 234 5678", "+20"), "+201012345678");
  assert.equal(A.normalizeIncomingPhone(201012345678, "+20"), "+201012345678");
  assert.equal(A.normalizeIncomingPhone("", "+20"), null);
  assert.equal(A.normalizeIncomingPhone("abc", "+20"), null);
  assert.ok(A.buildPhoneVariations("+201012345678").includes("01012345678"));
});

test("labels: exact text first, then containment", () => {
  const all = [{ id: "l1", text: "VIP customer" }, { id: "l2", text: "VIP" }, { id: "l3", text: "laptop" }];
  assert.deepEqual(A.matchLabelIdsFrom(all, ["vip"]), ["l2"]);
  assert.deepEqual(A.matchLabelIdsFrom(all, ["needs laptop", "unknown"]), ["l3"]);
  assert.deepEqual(A.matchLabelIdsFrom(all, []), []);
  assert.deepEqual(A.matchLabelIdsFrom(all, "vip"), []);
});
