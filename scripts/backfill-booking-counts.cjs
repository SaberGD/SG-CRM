// Sets activeBookingsCount (number of ACTIVE accounting bookings) and multiCourse (>= 2) on the
// clients that already have accounting bookings. New syncs write both fields themselves
// (functions/accountingIngest.js); this fills in the clients synced before that. The clients list
// uses multiCourse == true for the "اشترى أكتر من كورس" filter.
//
//   KEY=/path/to/service-account.json node scripts/backfill-booking-counts.cjs              (dry run)
//   KEY=... node scripts/backfill-booking-counts.cjs --execute
//   KEY=... node scripts/backfill-booking-counts.cjs --restore=<backup file> [--force]
// (KEY may be left out when GOOGLE_APPLICATION_CREDENTIALS is set.)
//
// Reads only clients with accountingLastSyncedAt > 0 (one query, the synced ones). A client whose
// two fields are already right is skipped, so running it again changes nothing. --execute first
// writes ~/backups/backfill-booking-counts-<time>.json with the old value of both fields, then
// updates in batches of 400. --restore puts the old values back (deleting the fields that did not
// exist), skipping clients whose values changed since unless --force.
const fs = require('fs');
const path = require('path');
const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
const PROJECT = 'sg-crm-e3a38';
const KEY = process.env.KEY;
admin.initializeApp(KEY ? { credential: admin.credential.cert(require(path.resolve(KEY))), projectId: PROJECT } : { projectId: PROJECT });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const FIELDS = ['activeBookingsCount', 'multiCourse'];
const EXECUTE = process.argv.includes('--execute');
const FORCE = process.argv.includes('--force');
const restoreFile = (process.argv.find((a) => a.startsWith('--restore=')) || '').split('=').slice(1).join('=');

const activeCount = (c) => Object.values(c.accounting?.bookings || {}).filter((b) => b && b.status === 'ACTIVE').length;

(async () => {
  if (restoreFile) {
    const backup = JSON.parse(fs.readFileSync(path.resolve(restoreFile), 'utf8'));
    let restored = 0; const skipped = [];
    for (let i = 0; i < backup.clients.length; i += 400) {
      const rows = backup.clients.slice(i, i + 400);
      const snaps = await db.getAll(...rows.map((r) => db.collection('clients').doc(r.id)));
      const batch = db.batch(); let n = 0;
      rows.forEach((r, k) => {
        const cur = snaps[k];
        const untouched = cur.exists && cur.get('activeBookingsCount') === r.new.activeBookingsCount && cur.get('multiCourse') === r.new.multiCourse;
        if (!cur.exists || (!untouched && !FORCE)) { skipped.push(r.id); return; }
        const patch = {};
        FIELDS.forEach((f) => { patch[f] = f in r.old ? r.old[f] : FV.delete(); });
        batch.update(cur.ref, patch); n++;
      });
      if (n) await batch.commit();
      restored += n;
    }
    console.log(`restored ${restored} clients from ${restoreFile}; skipped ${skipped.length} (changed since${FORCE ? '' : ', use --force to restore anyway'})`);
    if (skipped.length) console.log('skipped ids:', skipped.slice(0, 50).join(', '), skipped.length > 50 ? '...' : '');
    return;
  }

  const snap = await db.collection('clients').where('accountingLastSyncedAt', '>', 0).select('accounting', ...FIELDS).get();
  const rows = []; const hist = {};
  snap.docs.forEach((d) => {
    const c = d.data();
    const count = activeCount(c);
    hist[count] = (hist[count] || 0) + 1;
    const next = { activeBookingsCount: count, multiCourse: count >= 2 };
    if (c.activeBookingsCount === next.activeBookingsCount && c.multiCourse === next.multiCourse) return;
    const old = {}; FIELDS.forEach((f) => { if (c[f] !== undefined) old[f] = c[f]; });
    rows.push({ id: d.id, old, new: next });
  });
  console.log(`synced clients: ${snap.size} | to update: ${rows.length} | with 2+ active bookings: ${rows.filter((r) => r.new.multiCourse).length}`);
  console.log('active bookings per client:', JSON.stringify(hist));
  if (!EXECUTE) { console.log('dry run: nothing written. Add --execute to write.'); return; }

  const dir = path.join(process.env.HOME, 'backups'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `backfill-booking-counts-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: Date.now(), clients: rows.map(({ id, old, new: n }) => ({ id, old, new: n })) }));
  console.log('backup written:', file);
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    rows.slice(i, i + 400).forEach((r) => batch.update(db.collection('clients').doc(r.id), r.new));
    await batch.commit();
  }
  console.log(`written: ${rows.length}. Undo with --restore=${file}`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
