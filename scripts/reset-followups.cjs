// Clears every scheduled follow-up on clients (owner's request 2026-11-05: start clean;
// sales already contacted these people or forgot them). The contact history (followups
// collection) is NOT touched. Before writing, the removed values of every client are saved
// in app_settings/followup_reset_<time> so they can be restored.
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/reset-followups.cjs [--apply]
// Undo:  node scripts/reset-followups.cjs --restore=followup_reset_<time>
const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
admin.initializeApp({ projectId: 'sg-crm-e3a38' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const FIELDS = ['nextFollowUpDate', 'nextFollowUpMethod', 'nextFollowUpSetVia', 'nextFollowUpReason', 'nextFollowUpReviewedBySales', 'nextFollowUpReviewedByName', 'nextFollowUpReviewedAt'];
const apply = process.argv.includes('--apply');
const restoreId = (process.argv.find((a) => a.startsWith('--restore=')) || '').split('=')[1];
(async () => {
  if (restoreId) {
    const snap = await db.collection('app_settings').doc(restoreId).get();
    const rows = snap.get('clients') || [];
    for (let i = 0; i < rows.length; i += 400) {
      const batch = db.batch();
      rows.slice(i, i + 400).forEach((r) => batch.update(db.collection('clients').doc(r.id), r.old));
      await batch.commit();
    }
    console.log(`restored ${rows.length} clients from ${restoreId}`);
    return;
  }
  const [scheduled, unreviewed] = await Promise.all([
    db.collection('clients').where('nextFollowUpDate', '>', 0).get(),
    db.collection('clients').where('nextFollowUpReviewedBySales', '==', false).get(),
  ]);
  const byId = new Map();
  [...scheduled.docs, ...unreviewed.docs].forEach((d) => byId.set(d.id, d));
  const now = Date.now();
  const rows = [...byId.values()].map((d) => {
    const old = {}; FIELDS.forEach((f) => { if (d.get(f) !== undefined) old[f] = d.get(f); });
    return { id: d.id, name: d.get('name') || '', agent: d.get('salesAgentName') || '', old };
  });
  const overdue = rows.filter((r) => r.old.nextFollowUpDate > 0 && r.old.nextFollowUpDate < now).length;
  const upcoming = rows.filter((r) => r.old.nextFollowUpDate >= now).length;
  console.log(`clients to reset: ${rows.length} (overdue ${overdue}, upcoming ${upcoming}, flag only ${rows.length - overdue - upcoming})`);
  if (!apply) { console.log('dry run, nothing written (pass --apply)'); return; }
  const backupId = `followup_reset_${new Date(now).toISOString().replace(/[:.]/g, '-')}`;
  await db.collection('app_settings').doc(backupId).set({ at: now, reason: 'owner asked to clear all scheduled follow-ups', count: rows.length, clients: rows });
  console.log(`backup saved: app_settings/${backupId}`);
  let done = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    rows.slice(i, i + 400).forEach((r) => {
      const patch = { nextFollowUpDate: 0 };
      FIELDS.slice(1).forEach((f) => { patch[f] = FV.delete(); });
      batch.update(db.collection('clients').doc(r.id), patch);
    });
    await batch.commit();
    done += Math.min(400, rows.length - i);
  }
  console.log(`reset ${done} clients`);
})();
