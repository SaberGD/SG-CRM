// Moves the CRM clients that sit on the owner's admin account (saber.gd.fl) to the sales person
// who really owns them in the accounting system: the sales name on the client's latest ACTIVE
// accounting booking. A client whose bookings are all inactive goes to FALLBACK. Clients with no
// accounting booking stay where they are. Asked for by the owner on 2026-11-17: the automatic
// check-in follow-ups of 290 booked clients were landing on the owner instead of the sales team.
//
//   KEY=/path/to/service-account.json node scripts/reassign-owner-clients.cjs              (dry run)
//   KEY=... node scripts/reassign-owner-clients.cjs --execute
//   KEY=... node scripts/reassign-owner-clients.cjs --restore=<backup file> [--force]
// (KEY may be left out when GOOGLE_APPLICATION_CREDENTIALS is set. The key must read the
// accounting project too.)
//
// --execute first writes ~/backups/reassign-owner-clients-<time>.json (old agent of every client),
// then updates in batches: salesAgentId, salesAgentName, one transferHistory record and one
// transfers/reassign_<clientId> document, the same trail the "تحويل" button leaves. Running it
// again changes nothing (the moved clients are no longer on the owner). --restore puts the old
// agent back and removes that trail, skipping clients that were moved again since unless --force.
const fs = require('fs');
const path = require('path');
const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
const KEY = process.env.KEY;
const cred = KEY ? { credential: admin.credential.cert(require(path.resolve(KEY))) } : {};
const db = admin.initializeApp({ ...cred, projectId: 'sg-crm-e3a38' }).firestore();
const acc = admin.initializeApp({ ...cred, projectId: 'crm---acounting-sg' }, 'accounting').firestore();

const OWNER_NAME = 'saber.gd.fl';
// accounting sales name -> CRM user name (the two systems spell them differently)
const SALES_TO_CRM_USER = { 'Aliaa': 'Alyaa Elsayed', 'Tasneem Ahmed': 'Tasneem Ahmad', 'Lamia Tarek': 'Lamia Tarek', 'Yasmin Gamal': 'Yasmin Gamal' };
const FALLBACK = 'Alyaa Elsayed';
const REASON = 'تصحيح: العميل تبع السيلز ده في نظام الحسابات';
const ACTOR = { performedById: 'system', performedByName: 'تصحيح من نظام الحسابات' };
const EXECUTE = process.argv.includes('--execute');
const FORCE = process.argv.includes('--force');
const restoreFile = (process.argv.find((a) => a.startsWith('--restore=')) || '').split('=').slice(1).join('=');
const transferId = (clientId) => `reassign_${clientId}`;

(async () => {
  if (restoreFile) {
    const backup = JSON.parse(fs.readFileSync(path.resolve(restoreFile), 'utf8'));
    let restored = 0; const skipped = [];
    for (let i = 0; i < backup.clients.length; i += 200) {
      const rows = backup.clients.slice(i, i + 200);
      const snaps = await db.getAll(...rows.map((r) => db.collection('clients').doc(r.id)));
      const batch = db.batch();
      rows.forEach((r, k) => {
        const cur = snaps[k].exists ? snaps[k].data() : null;
        if (!cur || (cur.salesAgentId !== r.newAgentId && !FORCE)) { skipped.push(r.id); return; }
        batch.update(snaps[k].ref, {
          salesAgentId: r.oldAgentId, salesAgentName: r.oldAgentName,
          transferHistory: (cur.transferHistory || []).filter((t) => t.id !== transferId(r.id)),
        });
        batch.delete(db.collection('transfers').doc(transferId(r.id)));
        restored++;
      });
      await batch.commit();
    }
    console.log(`restored ${restored} clients. skipped (moved again since): ${skipped.length}`, skipped.slice(0, 20).join(' '));
    return;
  }

  const users = (await db.collection('users').get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => !u.isDeactivated);
  const one = (name) => {
    const hits = users.filter((u) => u.name === name);
    if (hits.length !== 1) throw new Error(`expected exactly one active CRM user named "${name}", found ${hits.length}`);
    return { id: hits[0].id, name: hits[0].name };
  };
  const owner = one(OWNER_NAME);
  const fallback = one(FALLBACK);
  const clients = (await db.collection('clients').where('salesAgentId', '==', owner.id).get()).docs;
  const ids = [...new Set(clients.flatMap((d) => d.data().accountingBookingIds || []))];
  const bookings = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const snaps = await acc.getAll(...ids.slice(i, i + 100).map((id) => acc.collection('bookings').doc(id)), { fieldMask: ['salesName', 'status', 'bookingDate', 'createdAt', 'isDeleted'] });
    snaps.forEach((s) => s.exists && bookings.set(s.id, s.data()));
  }

  const plan = []; const unlinked = []; const unknownSales = {};
  for (const d of clients) {
    const c = d.data();
    const linked = (c.accountingBookingIds || []).map((id) => bookings.get(id)).filter(Boolean);
    if (!linked.length) { unlinked.push(d.id); continue; }
    const active = linked.filter((b) => b.status === 'ACTIVE' && !b.isDeleted)
      .sort((a, b) => String(b.bookingDate || b.createdAt || '').localeCompare(String(a.bookingDate || a.createdAt || '')));
    let target = fallback; let why = 'no active booking';
    if (active.length) {
      const sales = String(active[0].salesName || '').trim();
      const crmName = SALES_TO_CRM_USER[sales];
      if (!crmName) { unknownSales[sales || '(empty)'] = (unknownSales[sales || '(empty)'] || 0) + 1; continue; }
      target = one(crmName); why = `latest active booking: ${sales}`;
    }
    plan.push({ id: d.id, name: c.name || '', oldAgentId: c.salesAgentId, oldAgentName: c.salesAgentName || '', newAgentId: target.id, newAgentName: target.name, why, history: c.transferHistory || [] });
  }

  const tally = {};
  plan.forEach((p) => { const k = `${p.newAgentName} (${p.why === 'no active booking' ? 'no active booking' : 'active booking'})`; tally[k] = (tally[k] || 0) + 1; });
  console.log(`on ${owner.name}: ${clients.length} clients · to move: ${plan.length} · staying (no accounting booking): ${unlinked.length}`);
  console.log('move to:', JSON.stringify(tally));
  if (Object.keys(unknownSales).length) console.log('left alone, sales name with no CRM user mapped:', JSON.stringify(unknownSales));
  if (!EXECUTE) { console.log('dry run: nothing written. Add --execute to back up and write.'); return; }

  const dir = path.join(process.env.HOME || '.', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `reassign-owner-clients-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), clients: plan.map(({ history, name, ...rest }) => rest) }));
  console.log('backup:', file);
  const now = Date.now();
  for (let i = 0; i < plan.length; i += 200) {
    const batch = db.batch();
    for (const p of plan.slice(i, i + 200)) {
      const record = { id: transferId(p.id), clientId: p.id, clientName: p.name, oldAgentId: p.oldAgentId, oldAgentName: p.oldAgentName, newAgentId: p.newAgentId, newAgentName: p.newAgentName, reason: REASON, timestamp: now, ...ACTOR };
      batch.set(db.collection('transfers').doc(record.id), record);
      batch.update(db.collection('clients').doc(p.id), { salesAgentId: p.newAgentId, salesAgentName: p.newAgentName, transferHistory: [...p.history.filter((t) => t.id !== record.id), record] });
    }
    await batch.commit();
  }
  console.log(`moved ${plan.length} clients. Undo: --restore=${file}`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
