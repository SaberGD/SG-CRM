// Gives every client without a nextFollowUpDate field the value 0 ("no follow-up date"),
// so "open leads without a date" can be queried on the server (Firestore cannot query a
// missing field). Dry run by default; pass --apply to write.
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/backfill-next-followup.cjs [--apply]
const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
admin.initializeApp({ projectId: 'sg-crm-e3a38' });
const db = admin.firestore();
const apply = process.argv.includes('--apply');
(async () => {
  const snap = await db.collection('clients').select('nextFollowUpDate', 'status').get();
  const missing = snap.docs.filter((d) => typeof d.get('nextFollowUpDate') !== 'number');
  const byStatus = {};
  missing.forEach((d) => { const s = d.get('status') || '(none)'; byStatus[s] = (byStatus[s] || 0) + 1; });
  console.log(`clients: ${snap.size}, without a numeric nextFollowUpDate: ${missing.length}`, byStatus);
  if (!apply) { console.log('dry run, nothing written (pass --apply)'); return; }
  let done = 0;
  for (let i = 0; i < missing.length; i += 400) {
    const batch = db.batch();
    missing.slice(i, i + 400).forEach((d) => batch.update(d.ref, { nextFollowUpDate: 0 }));
    await batch.commit();
    done += Math.min(400, missing.length - i);
  }
  console.log(`updated ${done}`);
})();
