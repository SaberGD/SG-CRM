const test = require("node:test");
const assert = require("node:assert/strict");
const { sha256, internationalPhone, customerUserData, purchaseEventForBooking, sendEvents, MAX_EVENT_AGE_MS } = require("./metaCapi");
const { summarizeBooking } = require("./accountingIngest");

const NOW = Date.parse("2026-11-17T18:00:00Z");
const booking = (over = {}) => ({ status: "ACTIVE", bookingDate: "2026-11-17", createdAt: "2026-11-17T10:00:00.000Z", productId: "p1", productType: "course", pricing: { finalPriceSnapshot: 3250 }, paymentSummary: { paidTotal: 800, remaining: 2450 }, ...over });
const customer = { name: "Ahmed Mohamed Ali", phone: "01012345678", whatsapp: "1012345678", fullWhatsapp: "+201012345678", countryCode: "+20", email: "A@Example.com " };
const build = (b = booking(), c = customer) => purchaseEventForBooking({ bookingId: "bk1", booking: b, customer: c, summary: summarizeBooking("bk1", b, "Graphic Design", NOW), clientId: "cl1", now: NOW });

test("phones become full international digits", () => {
  assert.equal(internationalPhone("01012345678", "+20"), "201012345678");
  assert.equal(internationalPhone("1012345678", "+20"), "201012345678");
  assert.equal(internationalPhone("+20 101 234 5678", "+20"), "201012345678");
  assert.equal(internationalPhone("00966501234567", "+966"), "966501234567");
  assert.equal(internationalPhone("123", "+20"), "");
});

test("user data is hashed, deduplicated and complete", () => {
  const u = customerUserData(customer, "cl1");
  assert.deepEqual(u.ph, [sha256("201012345678")]);
  assert.deepEqual(u.em, [sha256("a@example.com")]);
  assert.deepEqual(u.fn, [sha256("ahmed")]);
  assert.deepEqual(u.ln, [sha256("ali")]);
  assert.deepEqual(u.country, [sha256("eg")]);
  assert.deepEqual(u.external_id, [sha256("cl1")]);
  assert.ok(!JSON.stringify(u).includes("1012345678"), "no raw phone");
  assert.equal(customerUserData({ ...customer, email: "not-an-email" }).em, undefined);
});

test("a new active booking becomes one Purchase with the booking as event_id", () => {
  const { event, skip } = build();
  assert.equal(skip, undefined);
  assert.equal(event.event_name, "Purchase");
  assert.equal(event.event_id, "booking_bk1");
  assert.equal(event.action_source, "system_generated");
  assert.equal(event.event_time, Math.floor(Date.parse("2026-11-17T10:00:00.000Z") / 1000));
  assert.equal(event.custom_data.value, 3250);
  assert.equal(event.custom_data.currency, "EGP");
  assert.equal(event.custom_data.order_id, "bk1");
  assert.equal(event.custom_data.content_name, "Graphic Design");
  assert.deepEqual(event.custom_data.content_ids, ["p1"]);
});

test("refunded, deleted, old or contactless bookings are not sent", () => {
  assert.equal(build(booking({ status: "REFUNDED" })).skip, "inactive");
  assert.equal(build(booking({ isDeleted: true })).skip, "inactive");
  assert.equal(build(booking({ createdAt: new Date(NOW - MAX_EVENT_AGE_MS - 1000).toISOString() })).skip, "too_old");
  assert.equal(build(booking(), { name: "X", countryCode: "+20" }).skip, "no_contact");
});

test("without createdAt the booking date is used; a future time is clamped to now", () => {
  const { event } = build(booking({ createdAt: undefined, bookingDate: "2026-11-18" }));
  assert.equal(event.event_time, Math.floor(NOW / 1000));
  assert.equal(build(booking({ createdAt: undefined, bookingDate: "2026-10-01" })).skip, "too_old");
});

test("sendEvents passes the test code and surfaces Meta errors", async () => {
  let sent;
  const ok = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ events_received: 1, fbtrace_id: "t" }) }; };
  const out = await sendEvents({ pixelId: "1", accessToken: "tok", events: [{ a: 1 }], testEventCode: "TEST1", fetchImpl: ok });
  assert.equal(out.eventsReceived, 1);
  assert.equal(sent.body.test_event_code, "TEST1");
  const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 100, type: "OAuthException", message: "bad" } }) });
  await assert.rejects(sendEvents({ pixelId: "1", accessToken: "tok", events: [], fetchImpl: bad }), (e) => e.meta.code === 100);
});
