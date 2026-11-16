// Moves the personal check-in (اطمئنان) of booked clients out of the normal follow-up fields:
// first release stored it in nextFollowUpDate with nextFollowUpSetVia === 'auto_booked', which
// made it show in the overdue/today/upcoming tabs, dashboard counts and alarm. It now lives in
// nextCheckInDate (see utils/autoFollowUp.ts).
//
// For every client with nextFollowUpSetVia === 'auto_booked':
//   nextCheckInDate = nextFollowUpDate (same date), nextFollowUpDate = 0, and the fields
//   nextFollowUpSetVia / Reason / Method / ReviewedBySales / ReviewedByName / ReviewedAt are
//   deleted. Only clients whose setVia is exactly 'auto_booked' are touched (a date a person
//   or the AI set has another setVia and is never changed).
//
//   KEY=/path/to/service-account.json node scripts/migrate-checkins.cjs              (dry run)
//   KEY=... node scripts/migrate-checkins.cjs --execute
//   KEY=... node scripts/migrate-checkins.cjs --restore=<backup file> [--force]
// (KEY may be left out when GOOGLE_APPLICATION_CREDENTIALS is set.)
//
// --execute first writes ~/backups/migrate-checkins-<time>.json with the old value of every
// field it changes, then updates in batches of 400. Running it again does nothing (no client
// has setVia 'auto_booked' any more). --restore puts the old values back, skipping clients
// changed since (their check-in date moved or their normal follow-up date was set) unless --force.
const fs = require('fs');
const path = require('path');
const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
const PROJECT = 'sg-crm-e3a38';
const KEY = process.env.KEY;
admin.initializeApp(KEY ? { credential: admin.credential.cert(require(path.resolve(KEY))), projectId: PROJECT } : { projectId: PROJECT });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const OLD_FIELDS = ['nextFollowUpDate', 'nextFollowUpSetVia', 'nextFollowUpReason', 'nextFollowUpMethod',
  'nextFollowUpReviewedBySales', 'nextFollowUpReviewedByName', 'nextFollowUpReviewedAt'];
const FIELDS = [...OLD_FIELDS, 'nextCheckInDate'];
const EXECUTE = process.argv.includes('--execute');
const FORCE = process.argv.includes('--force');
const restoreFile = (process.argv.find((a) => a.startsWith('--restore=')) || '').split('=').slice(1).join('=');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

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
        // Untouched since the migration: same check-in date, no new normal follow-up date.
        const untouched = cur.exists && (cur.get('nextCheckInDate') || 0) === r.new.nextCheckInDate && !(cur.get('nextFollowUpDate') > 0);
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

  const now = Date.now();
  const snap = await db.collection('clients').where('nextFollowUpSetVia', '==', 'auto_booked').select(...FIELDS, 'salesAgentName').get();
  const rows = []; const why = { noDate: 0 };
  snap.docs.forEach((d) => {
    const c = d.data();
    const date = typeof c.nextFollowUpDate === 'number' && c.nextFollowUpDate > 0 ? c.nextFollowUpDate : 0;
    const existing = typeof c.nextCheckInDate === 'number' && c.nextCheckInDate > 0 ? c.nextCheckInDate : 0;
    const target = existing || date; // an existing nextCheckInDate wins
    if (!target) why.noDate++;
    const old = {}; FIELDS.forEach((f) => { if (c[f] !== undefined) old[f] = c[f]; });
    const patch = { nextCheckInDate: target, nextFollowUpDate: 0 };
    OLD_FIELDS.slice(1).forEach((f) => { patch[f] = FV.delete(); });
    rows.push({ id: d.id, agent: c.salesAgentName || '', date: target ? day(target) : null, overdue: !!target && target < now, old, patch, new: { nextCheckInDate: target } });
  });

  const perAgent = {}; const perDay = {};
  rows.forEach((r) => { perAgent[r.agent || '(no agent)'] = (perAgent[r.agent || '(no agent)'] || 0) + 1; if (r.date) perDay[r.date] = (perDay[r.date] || 0) + 1; });
  console.log(`clients with nextFollowUpSetVia 'auto_booked': ${rows.length} (overdue ${rows.filter((r) => r.overdue).length}, without a date ${why.noDate})`);
  console.log('per sales person:', perAgent);
  console.log('check-in date per day:', Object.fromEntries(Object.entries(perDay).sort()));
  console.log('sample (no names/phones):', rows.slice(0, 10).map((r) => ({ id: r.id, agent: r.agent, nextCheckInDate: r.date })));
  if (!EXECUTE) { console.log('dry run, nothing written (pass --execute)'); return; }
  if (!rows.length) { console.log('nothing to do'); return; }

  const dir = path.join(process.env.HOME || '.', 'backups'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `migrate-checkins-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: now, project: PROJECT, reason: 'move personal check-ins from nextFollowUpDate to nextCheckInDate', count: rows.length,
    clients: rows.map((r) => ({ id: r.id, agent: r.agent, old: r.old, new: r.new })) }, null, 1));
  console.log(`backup saved: ${file}`);

  let done = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    rows.slice(i, i + 400).forEach((r) => batch.update(db.collection('clients').doc(r.id), r.patch));
    await batch.commit();
    done += Math.min(400, rows.length - i);
    console.log(`updated ${done}/${rows.length}`);
  }
  await db.collection('logs').add({ userId: 'system:migrate', userName: 'سكريبت نقل الاطمئنان', action: `نقل موعد الاطمئنان لـ ${done} عميل لخانة منفصلة (nextCheckInDate). النسخة الاحتياطية: ${path.basename(file)}`,
    targetId: 'MIGRATION', targetName: 'check-ins', timestamp: Date.now() });
  console.log(`done. undo: node scripts/migrate-checkins.cjs --restore=${file}`);
})().catch((e) => { console.error(e); process.exit(1); });
