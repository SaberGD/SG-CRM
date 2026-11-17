const test = require("node:test");
const assert = require("node:assert/strict");
const { pullClientSnapshot, SnapshotError, scrub, buildLookupBody, DAILY_LIMIT, CACHE_MS, firestoreStore, ACCOUNTING, TRAINING } = require("./clientSnapshot");

const NOW = Date.parse("2026-12-10T12:00:00+02:00");
const owner = { uid: "u1", role: "sales_agent", name: "تسنيم" };
const other = { uid: "u2", role: "sales_agent", name: "علي" };
const leader = { uid: "m1", role: "supervisor", name: "ليدر" };

const ACC = { found: true, customer: { id: "c1", name: "منى", referralCode: "SG1" }, bookings: [
  { id: "b1", status: "ACTIVE", productName: "جرافيك", productType: "course", group: { name: "G1", startDate: "2026-11-01" }, paid: 1000, remaining: 500, pricing: { finalPrice: 1500 },
    lastPayment: { date: "2026-11-02", amount: 1000, method: "cash" }, nextDue: { date: "2026-12-20", amount: 500 }, overdue: [],
    installments: [{ dueDate: "2026-11-02", amount: 1000, paidAmount: 1000, status: "paid" }, { dueDate: "2026-12-20", amount: 500, paidAmount: 0, status: "pending" }] } ] };
const TRN = { found: true, students: [{ sourceBookingId: "b1", groupName: "G1", courseName: "جرافيك", startDate: "2026-11-01", endDate: "2026-12-01", totalSessions: 12, heldSessions: 12, attended: 9, attendancePct: 75,
  lastAttended: { sessionNumber: 9, date: "2026-11-28" }, absenceStreak: 3, tasks: { delivered: 4, required: 6 }, portal: { hasLoggedIn: true, lastLoginAt: "2026-11-20T10:00:00Z" } }] };

function setup({ client = {}, followups = [], quota = true, sys = {}, claude = {}, now = NOW } = {}) {
  const state = { saved: null, logged: [], quotaCalls: 0, fetches: [], claudeBody: null };
  const store = {
    getClient: async (id) => (id === "missing" ? null : { id, name: "منى أحمد", phone: "01012345678", salesAgentId: "u1", status: "booked", accountingBookingIds: ["b1"], ...client }),
    recentFollowUps: async () => followups,
    reserveQuota: async () => { state.quotaCalls += 1; return quota; },
    saveSnapshot: async (id, snapshot, top) => { state.saved = { id, snapshot, top }; },
    logAiCall: async (e) => { state.logged.push(e); },
  };
  const fetchImpl = async (url, opts) => {
    state.fetches.push({ url, opts });
    if (url.startsWith("https://api.anthropic.com")) {
      state.claudeBody = JSON.parse(opts.body);
      if (claude.fail) return { ok: false, status: 529, text: async () => "" };
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "ملخص جاهز" }], usage: { input_tokens: 500, output_tokens: 150 } }) };
    }
    const mode = url === ACCOUNTING.url ? sys.accounting : sys.training;
    if (mode === "down") return { ok: false, status: 500, json: async () => ({}) };
    if (mode === "throw") { const e = new Error("t"); e.name = "TimeoutError"; throw e; }
    return { ok: true, json: async () => (url === ACCOUNTING.url ? ACC : TRN) };
  };
  const deps = { store, fetchImpl, getIdToken: async (aud) => `tok-for-${aud}`, apiKey: "k", now: () => now };
  return { state, deps };
}
const pull = (ctx, user = owner, extra = {}) => pullClientSnapshot({ clientId: "c1", user, deps: ctx.deps, ...extra });
const rejects = (p, status) => assert.rejects(p, (e) => e instanceof SnapshotError && e.status === status);

test("auth matrix: owner and leader pass; another agent and the pool account's clients are refused", async () => {
  assert.equal((await pull(setup())).cached, false);
  assert.equal((await pull(setup(), leader)).cached, false);
  const c = setup();
  await rejects(pull(c, other), 403);
  assert.equal(c.state.fetches.length, 0); assert.equal(c.state.quotaCalls, 0); assert.equal(c.state.saved, null);
  // client still on the pool account: not the caller's, so only a leader may pull
  const pool = setup({ client: { salesAgentId: "pool-uid" } });
  await rejects(pull(pool, owner), 403);
  assert.equal((await pull(setup({ client: { salesAgentId: "pool-uid" } }), leader)).cached, false);
  await rejects(pullClientSnapshot({ clientId: "missing", user: owner, deps: setup().deps }), 404);
  await rejects(pullClientSnapshot({ clientId: "a/b", user: owner, deps: setup().deps }), 400);
});

test("a fresh pull calls both systems with OIDC tokens, writes the snapshot and logs the Claude call", async () => {
  const ctx = setup({ followups: [{ timestamp: NOW - 86400000, agentName: "تسنيم", method: "phone", result: "طلب يكلمه بعد المحاضرة", kind: "" }] });
  const { cached, snapshot } = await pull(ctx);
  assert.equal(cached, false);
  const calls = ctx.state.fetches.filter((f) => !f.url.includes("anthropic"));
  assert.deepEqual(calls.map((f) => f.url).sort(), [ACCOUNTING.url, TRAINING.url].sort());
  for (const f of calls) {
    assert.match(f.opts.headers.Authorization, /^Bearer tok-for-https:\/\/us-central1-/);
    assert.deepEqual(JSON.parse(f.opts.body), { bookingIds: ["b1"], phone: "01012345678" });
  }
  assert.equal(snapshot.briefing, "ملخص جاهز");
  assert.equal(snapshot.courses.length, 1);
  assert.equal(snapshot.courses[0].endDate, "2026-12-01");
  assert.equal(snapshot.followUps[0].result, "طلب يكلمه بعد المحاضرة");
});

test("lifecycle on the stored snapshot: 9 days after the end is alumni_due and flags the list field", async () => {
  const ctx = setup();
  const { snapshot } = await pull(ctx);
  assert.equal(snapshot.lifecycle.state, "alumni_due");
  assert.deepEqual(ctx.state.saved.top, { courseEndsAt: "2026-12-01", alumniDue: true });
  assert.equal(ctx.state.saved.id, "c1");
  // already moved to alumni: no longer "due"
  const done = setup({ client: { isAlumni: true } });
  await pull(done);
  assert.equal(done.state.saved.top.alumniDue, false);
});

test("Claude call is logged with tokens, and the request has no phone, e-mail or names", async () => {
  const ctx = setup({ client: { email: "mona@example.com", whatsapp: "+201099999999" },
    followups: [{ timestamp: NOW, agentName: "تسنيم", method: "phone", result: "كلمته على 01012345678 وإيميله mona@example.com ورقم تاني +20 109 999 9999 وبكرة 2026-12-11" }] });
  await pull(ctx);
  const sent = JSON.stringify(ctx.state.claudeBody);
  assert.equal(ctx.state.claudeBody.model, "claude-haiku-5-5");
  assert.equal(ctx.state.claudeBody.max_tokens, 2000);
  assert.equal(ctx.state.claudeBody.temperature, undefined);
  for (const secret of ["01012345678", "mona@example.com", "1099999999", "109 999 9999", "منى", "SG1"]) assert.ok(!sent.includes(secret), `leaked ${secret}`);
  assert.ok(sent.includes("2026-12-11"), "plain dates survive the scrub");
  assert.equal(ctx.state.logged.length, 1);
  assert.deepEqual({ ...ctx.state.logged[0] }, { kind: "client_snapshot", uid: "u1", clientId: "c1", model: "claude-haiku-5-5", ok: true, error: "", inputTokens: 500, outputTokens: 150, at: NOW });
});

test("cache: a snapshot younger than 10 minutes is returned with no external call and no quota", async () => {
  const cachedSnap = { pulledAt: NOW - CACHE_MS + 1000, briefing: "قديم" };
  const ctx = setup({ client: { snapshot360: cachedSnap } });
  const r = await pull(ctx);
  assert.equal(r.cached, true); assert.equal(r.snapshot.briefing, "قديم");
  assert.equal(ctx.state.fetches.length, 0); assert.equal(ctx.state.quotaCalls, 0); assert.equal(ctx.state.saved, null);
  // force, or an older snapshot, pulls again
  const forced = setup({ client: { snapshot360: cachedSnap } });
  assert.equal((await pull(forced, owner, { force: true })).cached, false);
  const old = setup({ client: { snapshot360: { pulledAt: NOW - CACHE_MS - 1 } } });
  assert.equal((await pull(old)).cached, false);
  // the cache never skips the auth check
  await rejects(pull(setup({ client: { snapshot360: cachedSnap } }), other), 403);
});

test("quota: over the daily limit is a 429 and nothing external runs", async () => {
  const ctx = setup({ quota: false });
  await rejects(pull(ctx), 429);
  assert.equal(ctx.state.fetches.length, 0); assert.equal(ctx.state.saved, null);
  assert.equal(DAILY_LIMIT, 40);
});

test("one system down gives a partial snapshot with its error, never a throw", async () => {
  const ctx = setup({ sys: { accounting: "down", training: "throw" } });
  const { snapshot } = await pull(ctx);
  assert.equal(snapshot.accounting, null); assert.equal(snapshot.training, null);
  assert.match(snapshot.accountingError, /500/); assert.match(snapshot.trainingError, /انتهى الوقت/);
  assert.equal(snapshot.lifecycle.state, "unknown");
  assert.ok(snapshot.briefing);
  const sent = JSON.stringify(ctx.state.claudeBody);
  assert.ok(sent.includes("accountingSystem") && sent.includes("trainingSystem"));

  const half = await pull(setup({ sys: { training: "down" } }));
  assert.ok(half.snapshot.accounting.found); assert.equal(half.snapshot.training, null); assert.equal(half.snapshot.accountingError, "");
  assert.equal(half.snapshot.courses.length, 1); // accounting alone still lists the course
});

test("a client with nothing to look up skips both systems", async () => {
  const ctx = setup({ client: { phone: "", accountingBookingIds: [] } });
  const { snapshot } = await pull(ctx);
  assert.equal(ctx.state.fetches.filter((f) => !f.url.includes("anthropic")).length, 0);
  assert.ok(snapshot.accountingError && snapshot.trainingError);
});

test("Claude failure: the snapshot is still stored, with an empty briefing, and the failed call is logged", async () => {
  const ctx = setup({ claude: { fail: true } });
  const { snapshot } = await pull(ctx);
  assert.equal(snapshot.briefing, ""); assert.equal(snapshot.model, "");
  assert.equal(snapshot.courses.length, 1);
  assert.equal(ctx.state.saved.snapshot.briefing, "");
  assert.equal(ctx.state.logged[0].ok, false); assert.match(ctx.state.logged[0].error, /529/);
});

test("follow-ups are trimmed to 280 chars and the lookup body only holds what the CRM knows", async () => {
  const long = "ا".repeat(900);
  const { snapshot } = await pull(setup({ followups: [{ timestamp: 5, agentName: "x", method: "phone", note: long }] }));
  assert.equal(snapshot.followUps[0].result.length, 280);
  assert.deepEqual(buildLookupBody({ phone: "010", accounting: { bookings: { b2: {} } }, accountingBookingIds: ["b1"], countryCode: "+20" }), { bookingIds: ["b1", "b2"], phone: "010", countryCode: "+20" });
});

test("scrub removes phones and e-mails but keeps dates and money", () => {
  assert.equal(scrub("اتصل 01012345678 او a.b@c.co"), "اتصل [number] او [email]");
  assert.equal(scrub("دفع 1500 جنيه يوم 2026-11-05"), "دفع 1500 جنيه يوم 2026-11-05");
});

test("firestore store: reads followups with one ordered limited query, quota in a transaction, update() for the snapshot", async () => {
  const log = [];
  const db = {
    collection: (c) => ({
      doc: (id) => ({ get: async () => ({ exists: true, id, data: () => ({ name: "x" }) }), update: async (p) => log.push(["update", c, id, Object.keys(p)]) }),
      where: (f, op, v) => ({ orderBy: (o, d) => ({ limit: (n) => ({ get: async () => { log.push(["q", c, f, op, v, o, d, n]); return { docs: [{ data: () => ({ a: 1 }) }] }; } }) }) }),
      add: async (e) => log.push(["add", c, e.kind]),
    }),
    doc: (path) => ({ path }),
    runTransaction: async (fn) => fn({ get: async () => ({ exists: true, data: () => ({ clientSnapshots: 39 }) }), set: (ref, v) => log.push(["set", ref.path, v.clientSnapshots]) }),
  };
  const s = firestoreStore(db);
  assert.equal((await s.getClient("c1")).name, "x");
  assert.deepEqual(await s.recentFollowUps("c1", 10), [{ a: 1 }]);
  assert.equal(await s.reserveQuota("u1", "2026-12-10", 40), true);
  await s.saveSnapshot("c1", { pulledAt: 1 }, { courseEndsAt: null, alumniDue: false });
  await s.logAiCall({ kind: "client_snapshot" });
  assert.deepEqual(log, [["q", "followups", "clientId", "==", "c1", "timestamp", "desc", 10], ["set", "ai_usage/u1_2026-12-10", 40], ["update", "clients", "c1", ["snapshot360", "courseEndsAt", "alumniDue"]], ["add", "ai_calls", "client_snapshot"]]);
  const full = firestoreStore({ ...db, runTransaction: async (fn) => fn({ get: async () => ({ exists: true, data: () => ({ clientSnapshots: 40 }) }), set: () => { throw new Error("no"); } }) });
  assert.equal(await full.reserveQuota("u1", "d", 40), false);
});
