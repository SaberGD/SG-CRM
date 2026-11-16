// Merge duplicate CRM clients that share a phone (last 10 digits), keeping the richest record.
//   node scripts/merge-by-phone.cjs            -> dry run (writes a backup + prints the plan)
//   node scripts/merge-by-phone.cjs --apply    -> merge
//   node scripts/merge-by-phone.cjs --restore=<client_merges id>   -> undo one merge
// Rules (owner, 2026-11-16): the client linked to accounting wins (accounting is the source of truth for
// money); otherwise planMerge's score decides. A real sales agent beats the shared pool account. Follow-ups
// are repointed, labels/notes combined, every removed client is archived to merged_clients/{id}.
// Groups with two accounting-linked clients, or two conflicting manual prices and no accounting, are NOT merged.
const path = require('path'); const fs = require('fs');
const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require(process.env.SA_KEY)), projectId: 'sg-crm-e3a38' });
const db = admin.firestore();
const APPLY = process.argv.includes('--apply');
const restoreArg = (process.argv.find((a) => a.startsWith('--restore=')) || '').split('=')[1];
const PLACEHOLDER = /^(no name|بدون|عميل|عميل تلقائي.*|مستخدم.*|john doe)$/i;
const hasAcc = (c) => !!(c.accounting || (c.accountingBookingIds || []).length);
const FILL = ['chatId', 'chatwootContactId', 'lastChatwootContactAt', 'profileLink', 'source', 'distinctiveSearchPhrase', 'position', 'gender', 'laptop', 'mode', 'serviceId', 'serviceName', 'countryCode', 'country', 'preferredMethod'];

(async () => {
  const { normalizePhoneKey, normalizeName, planMerge } = await import(path.join(__dirname, '..', 'utils', 'clientMerge.mjs'));
  if (restoreArg) {
    const m = (await db.collection('client_merges').doc(restoreArg).get()).data(); if (!m || !m.archive) throw new Error('no restorable merge ' + restoreArg);
    const b = db.batch();
    for (const dupId of m.duplicateIds) { const a = (await db.collection('merged_clients').doc(dupId).get()).data(); b.set(db.collection('clients').doc(dupId), a.data); b.delete(db.collection('merged_clients').doc(dupId)); }
    for (const f of m.followupMoves || []) b.update(db.collection('followups').doc(f.id), { clientId: f.from, clientName: f.fromName });
    const undo = { ...m.primaryBefore }; (m.addedKeys || []).forEach((k) => { undo[k] = admin.firestore.FieldValue.delete(); }); b.update(db.collection('clients').doc(m.primaryId), undo); await b.commit(); console.log('restored', restoreArg); return;
  }
  const clients = (await db.collection('clients').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const users = (await db.collection('users').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const fus = (await db.collection('followups').get()).docs;
  const dir = path.join(process.env.HOME, 'backups', 'crm-merge-' + new Date().toISOString().slice(0, 10)); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'clients.json'), JSON.stringify(clients)); fs.writeFileSync(path.join(dir, 'followups.json'), JSON.stringify(fus.map((d) => ({ id: d.id, ...d.data() })))); console.log('backup ->', dir);
  const pool = new Set(users.filter((u) => u.email === 'sabergroup.eg@gmail.com' || u.email === 'saber.gd.fl@gmail.com' || /Saber Group/.test(u.name || '')).map((u) => u.id));
  clients.forEach((c) => { if (/^(Saber Group|saber\.gd\.fl|مستخدم \(محدود\))$/.test(c.salesAgentName || '')) pool.add(c.salesAgentId); });
  const fuCounts = {}; fus.forEach((d) => { const i = d.data().clientId; fuCounts[i] = (fuCounts[i] || 0) + 1; });
  const by = new Map(); clients.forEach((c) => { const k = normalizePhoneKey(c.phone); if (k) (by.get(k) || by.set(k, []).get(k)).push(c); });
  const plans = [], skipped = [];
  for (const g of [...by.values()].filter((x) => x.length > 1)) {
    const acc = g.filter(hasAcc);
    if (acc.length > 1) { skipped.push({ why: 'two_accounting', g }); continue; }
    const copies = g.map((c) => (acc.length === 1 && !hasAcc(c) ? { ...c, isBooked: false, totalPrice: 0, paidAmount: 0, remainingAmount: 0 } : c));
    const p = planMerge(copies, { followupCounts: fuCounts, poolAgentIds: pool });
    if (!p.ok) { skipped.push({ why: p.reason, g }); continue; }
    if (acc.length === 1 && p.primaryId !== acc[0].id) { skipped.push({ why: 'primary_not_accounting', g }); continue; }
    const primary = g.find((c) => c.id === p.primaryId), dups = g.filter((c) => c.id !== p.primaryId);
    const patch = { ...p.patch };
    const names = g.map((c) => String(c.name || '').trim()).filter((n) => n && !PLACEHOLDER.test(n)).sort((a, b) => b.length - a.length);
    if (names[0] && names[0] !== primary.name) patch.name = names[0];
    for (const f of FILL) if (primary[f] === undefined || primary[f] === '' || primary[f] === null) { const d = dups.find((x) => x[f] !== undefined && x[f] !== '' && x[f] !== null); if (d) patch[f] = d[f]; }
    if (patch.name) { const { buildSearchKeys } = await import(path.join(__dirname, '..', 'functions', 'searchKeys.mjs')); patch.searchKeys = buildSearchKeys(patch.name, primary.phone); }
    plans.push({ primary, dups, patch });
  }
  const why = {}; skipped.forEach((s) => { why[s.why] = (why[s.why] || 0) + 1; });
  console.log('groups to merge:', plans.length, '| clients removed:', plans.reduce((n, p) => n + p.dups.length, 0), '| skipped:', JSON.stringify(why));
  plans.slice(0, 6).forEach((p) => console.log('  keep', p.primary.name, '<-', p.dups.map((d) => d.name).join(' + '), '| patch keys:', Object.keys(p.patch).join(',')));
  skipped.forEach((s) => console.log('  SKIP', s.why, '|', s.g.map((c) => `${c.name}[tp${c.totalPrice || 0}/${c.paidAmount || 0}${hasAcc(c) ? ',acc' : ''}]`).join(' | ')));
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plans.map((p) => ({ keep: p.primary.id, remove: p.dups.map((d) => d.id), patchKeys: Object.keys(p.patch) }))));
  if (!APPLY) { console.log('DRY RUN only'); return; }
  const now = Date.now(); let done = 0;
  for (const { primary, dups, patch } of plans) {
    const b = db.batch(); const moves = [];
    const before = {}, added = []; Object.keys(patch).forEach((k) => { if (primary[k] === undefined) added.push(k); else before[k] = primary[k]; });
    b.update(db.collection('clients').doc(primary.id), patch);
    for (const d of dups) {
      const { id, ...data } = d; b.set(db.collection('merged_clients').doc(d.id), { data, mergedInto: primary.id, mergedAt: now, mergedBy: 'script:merge-by-phone' });
      fus.filter((x) => x.data().clientId === d.id).forEach((x) => { moves.push({ id: x.id, from: d.id, fromName: x.data().clientName || d.name }); b.update(x.ref, { clientId: primary.id, clientName: patch.name || primary.name }); });
      b.delete(db.collection('clients').doc(d.id));
    }
    b.set(db.collection('client_merges').doc(), { primaryId: primary.id, duplicateIds: dups.map((d) => d.id), at: now, by: 'script:merge-by-phone', patchKeys: Object.keys(patch), archive: true, primaryBefore: before, addedKeys: added, followupMoves: moves });
    await b.commit(); done++;
  }
  console.log('merged groups:', done);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
