// Writes searchKeys (+ phoneKey) on every client whose keys are missing or stale. Updates only.
//   node scripts/backfill-search-keys.cjs [--apply]
const path = require('path');
const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
admin.initializeApp({ projectId: 'sg-crm-e3a38' });
const db = admin.firestore();
(async () => {
  const { buildSearchKeys } = await import(path.join(__dirname, '..', 'functions', 'searchKeys.mjs'));
  const { normalizePhoneKey } = await import(path.join(__dirname, '..', 'utils', 'clientMerge.mjs'));
  const snap = await db.collection('clients').get();
  const todo = [];
  snap.docs.forEach((d) => {
    const c = d.data(); const keys = buildSearchKeys(c.name, c.phone); const pk = normalizePhoneKey(c.phone);
    const same = Array.isArray(c.searchKeys) && c.searchKeys.join('|') === keys.join('|') && (c.phoneKey || '') === pk;
    if (!same) todo.push({ ref: d.ref, patch: { searchKeys: keys, phoneKey: pk } });
  });
  const avg = Math.round(todo.reduce((n, t) => n + t.patch.searchKeys.length, 0) / Math.max(1, todo.length));
  console.log('clients:', snap.size, '| need search keys:', todo.length, '| avg keys per client:', avg);
  if (!process.argv.includes('--apply')) return;
  for (let i = 0; i < todo.length; i += 400) { const b = db.batch(); todo.slice(i, i + 400).forEach((t) => b.update(t.ref, t.patch)); await b.commit(); }
  console.log('written:', todo.length);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
