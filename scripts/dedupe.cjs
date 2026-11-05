// Phone keys + duplicate merge for the CRM clients.
//   node scripts/dedupe.cjs keys            (dry run)   |  keys --apply
//   node scripts/dedupe.cjs merge-exact     (dry run)   |  merge-exact --apply
// Merging archives every removed client to merged_clients/{id} first, repoints its follow-ups
// and records the operation in client_merges, so it can be undone.
const path = require('path');
const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
admin.initializeApp({ projectId: 'sg-crm-e3a38' });
const db = admin.firestore();
const APPLY = process.argv.includes('--apply');
const mode = process.argv[2];

(async () => {
  const { normalizePhoneKey, normalizeName, planMerge } = await import(path.join(__dirname, '..', 'utils', 'clientMerge.mjs'));
  const clients = (await db.collection('clients').get()).docs.map((d) => ({ id: d.id, ...d.data() }));

  if (mode === 'keys') {
    let todo = clients.filter((c) => (c.phoneKey || '') !== normalizePhoneKey(c.phone));
    console.log('clients:', clients.length, '| need phoneKey update:', todo.length, '| without a usable phone:', clients.filter((c) => !normalizePhoneKey(c.phone)).length);
    if (APPLY) {
      for (let i = 0; i < todo.length; i += 400) {
        const b = db.batch();
        todo.slice(i, i + 400).forEach((c) => { const k = normalizePhoneKey(c.phone); b.update(db.collection('clients').doc(c.id), { phoneKey: k, phoneKeys: k ? [k] : [] }); });
        await b.commit();
      }
      console.log('phoneKey written for', todo.length);
    }
    return;
  }

  if (mode === 'merge-exact') {
    const users = (await db.collection('users').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const poolIds = new Set(users.filter((u) => u.email === 'sabergroup.eg@gmail.com' || u.email === 'saber.gd.fl@gmail.com' || /مستخدم|Saber Group/.test(u.name || '')).map((u) => u.id));
    // also treat clients stuck on the owner/pool/limited names as "pool"
    clients.forEach((c) => { if (/^(Saber Group|saber\.gd\.fl|مستخدم \(محدود\))$/.test(c.salesAgentName || '')) poolIds.add(c.salesAgentId); });
    const fus = (await db.collection('followups').get()).docs;
    const followupCounts = {}; fus.forEach((d) => { const id = d.data().clientId; followupCounts[id] = (followupCounts[id] || 0) + 1; });
    const byPhone = new Map();
    clients.forEach((c) => { const k = normalizePhoneKey(c.phone); if (k) (byPhone.get(k) || byPhone.set(k, []).get(k)).push(c); });
    const groups = [...byPhone.values()].filter((g) => g.length > 1 && g.every((c) => normalizeName(c.name) === normalizeName(g[0].name)));
    const plans = groups.map((g) => ({ g, plan: planMerge(g, { followupCounts, poolAgentIds: poolIds }) }));
    const ok = plans.filter((p) => p.plan.ok);
    const why = {}; plans.filter((p) => !p.plan.ok).forEach((p) => { why[p.plan.reason] = (why[p.plan.reason] || 0) + 1; });
    console.log('exact-name duplicate groups:', groups.length, '| auto-mergeable:', ok.length, '| left for review:', JSON.stringify(why), '| clients removed by merging:', ok.reduce((n, p) => n + p.plan.duplicateIds.length, 0));
    if (!APPLY) return;
    const now = Date.now();
    let merged = 0;
    for (const { g, plan } of ok) {
      const byId = Object.fromEntries(g.map((c) => [c.id, c]));
      const b = db.batch();
      b.update(db.collection('clients').doc(plan.primaryId), { ...plan.patch, phoneKey: normalizePhoneKey(byId[plan.primaryId].phone), phoneKeys: [normalizePhoneKey(byId[plan.primaryId].phone)] });
      for (const dupId of plan.duplicateIds) {
        const { id, ...data } = byId[dupId];
        b.set(db.collection('merged_clients').doc(dupId), { data, mergedInto: plan.primaryId, mergedAt: now, mergedBy: 'script:merge-exact' });
        fus.filter((d) => d.data().clientId === dupId).forEach((d) => b.update(d.ref, { clientId: plan.primaryId, clientName: byId[plan.primaryId].name }));
        b.delete(db.collection('clients').doc(dupId));
      }
      b.set(db.collection('client_merges').doc(), { primaryId: plan.primaryId, duplicateIds: plan.duplicateIds, at: now, by: 'script:merge-exact', patchKeys: Object.keys(plan.patch) });
      await b.commit(); merged++;
    }
    console.log('merged groups:', merged);
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
