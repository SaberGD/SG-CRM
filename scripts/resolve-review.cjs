// Resolves bookings waiting in sync_review (ambiguous phone) by matching the accounting
// customer's NAME against the candidate CRM clients. Updates only (no deletes):
//   node scripts/resolve-review.cjs            dry run
//   node scripts/resolve-review.cjs --apply
const path = require('path');
const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
admin.initializeApp({ projectId: 'sg-crm-e3a38' });
const db = admin.firestore();
const ing = require(path.join(__dirname, '..', 'functions', 'accountingIngest.js'));
const APPLY = process.argv.includes('--apply');

const nname = (s) => String(s || '').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const tokens = (s) => nname(s).split(' ').filter((t) => t.length > 1);
function nameScore(a, b) {
  const A = tokens(a), B = tokens(b); if (!A.length || !B.length) return 0;
  if (nname(a) === nname(b)) return 1;
  const shared = A.filter((t) => B.includes(t)).length;
  const firstSame = A[0] === B[0] ? 0.2 : 0;
  return Math.min(1, shared / Math.max(A.length, B.length) + firstSame);
}

(async () => {
  const reviews = (await db.collection('sync_review').get()).docs.filter((d) => !d.data().resolved && d.data().reason === 'ambiguous_phone');
  const fuCounts = {}; (await db.collection('followups').select('clientId').get()).docs.forEach((d) => { const id = d.data().clientId; fuCounts[id] = (fuCounts[id] || 0) + 1; });
  const out = { total: reviews.length, resolvable: 0, unclear: 0, noCandidates: 0 };
  const plan = [];
  for (const r of reviews) {
    const rv = r.data();
    const cands = (await Promise.all((rv.candidates || []).map((id) => db.doc(`clients/${id}`).get()))).filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
    if (!cands.length) { out.noCandidates++; continue; }
    const scored = cands.map((c) => ({ c, s: nameScore(rv.customerName, c.name) })).sort((a, b) => b.s - a.s);
    const best = scored[0];
    if (best.s < 0.5) { out.unclear++; continue; }
    // everything that matches almost as well is the same person recorded twice: keep the most useful record
    const close = scored.filter((x) => x.s >= best.s - 0.15);
    const pick = close.map((x) => x.c).sort((a, b) => ((b.isBooked ? 100 : 0) + (b.totalPrice > 0 ? 50 : 0) + (fuCounts[b.id] || 0)) - ((a.isBooked ? 100 : 0) + (a.totalPrice > 0 ? 50 : 0) + (fuCounts[a.id] || 0)))[0];
    out.resolvable++;
    plan.push({ review: r.ref, bookingId: rv.bookingId, summary: rv.summary, client: pick, score: best.s, ties: close.length });
  }
  console.log(JSON.stringify(out), '| of resolvable, matched among several same-person records:', plan.filter((p) => p.ties > 1).length);
  if (!APPLY) { plan.slice(0, 4).forEach((p) => console.log('  e.g.', p.bookingId, '->', p.client.name, `(score ${p.score.toFixed(2)})`)); return; }
  let done = 0;
  for (const p of plan) {
    const now = Date.now();
    await db.runTransaction(async (tx) => {
      const ref = db.collection('clients').doc(p.client.id);
      const cur = (await tx.get(ref)).data() || {};
      const res = ing.planClientAccounting(cur, p.summary, now);
      tx.update(ref, { ...res.patch, accountingBookingIds: admin.firestore.FieldValue.arrayUnion(p.bookingId) });
    });
    await p.review.update({ resolved: true, resolvedClientId: p.client.id, resolvedAt: Date.now(), resolvedBy: 'script:name-match' });
    done++;
  }
  console.log('linked bookings:', done);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
