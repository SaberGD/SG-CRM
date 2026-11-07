// Switches ON the automatic personal follow-up every 2 weeks (utils/autoFollowUp) for clients
// who booked in the last 3 months (owner's request 2026-11-07). New bookings get it on their
// own; this is the one-time start for the existing ones.
//
// Target: status 'booked' (or isBooked true), newest booking date (bookingDate /
// accountingLatestBookingDate / newest ACTIVE accounting booking) within the last 90 days,
// not refunded/deleted in accounting, and no autoFollowUp field yet. The first date is
// bookingDate + k*14 days (the first one not in the past), so they spread over the next 2
// weeks. A date already set by a person or the AI is kept.
//
//   KEY=/path/to/service-account.json node scripts/enable-auto-followups.cjs            (dry run)
//   KEY=... node scripts/enable-auto-followups.cjs --execute
//   KEY=... node scripts/enable-auto-followups.cjs --restore=<backup file> [--force]
// (KEY may be left out when GOOGLE_APPLICATION_CREDENTIALS is set.)
//
// --execute first writes ~/backups/auto-followups-<time>.json with the old values of every
// field it changes, then updates in batches of 400. --restore puts those old values back, but
// skips clients whose automatic follow-up changed since (someone stopped/re-started it, or the
// accounting sync touched it) unless --force.
const fs = require('fs');
const path = require('path');
const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
const PROJECT = 'sg-crm-e3a38';
const KEY = process.env.KEY;
admin.initializeApp(KEY ? { credential: admin.credential.cert(require(path.resolve(KEY))), projectId: PROJECT } : { projectId: PROJECT });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const FIELDS = ['autoFollowUp', 'nextFollowUpDate', 'nextFollowUpSetVia', 'nextFollowUpReason', 'nextFollowUpMethod',
  'nextFollowUpReviewedBySales', 'nextFollowUpReviewedByName', 'nextFollowUpReviewedAt'];
const READ = ['status', 'isBooked', 'bookingDate', 'accountingLatestBookingDate', 'accounting', 'salesAgentId', 'salesAgentName', ...FIELDS];
const EXECUTE = process.argv.includes('--execute');
const FORCE = process.argv.includes('--force');
const restoreFile = (process.argv.find((a) => a.startsWith('--restore=')) || '').split('=').slice(1).join('=');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

(async () => {
  const auto = await import(path.join(__dirname, '..', 'functions', 'autoFollowUp.mjs'));

  if (restoreFile) {
    const backup = JSON.parse(fs.readFileSync(path.resolve(restoreFile), 'utf8'));
    let restored = 0; const skipped = [];
    for (let i = 0; i < backup.clients.length; i += 400) {
      const rows = backup.clients.slice(i, i + 400);
      const snaps = await db.getAll(...rows.map((r) => db.collection('clients').doc(r.id)));
      const batch = db.batch(); let n = 0;
      rows.forEach((r, k) => {
        const cur = snaps[k];
        const af = cur.exists ? cur.get('autoFollowUp') : null;
        const untouched = af && af.startedVia === 'backfill' && af.startedAt === backup.at && af.enabled === true &&
          (cur.get('nextFollowUpDate') || 0) === (r.new.nextFollowUpDate ?? cur.get('nextFollowUpDate') ?? 0);
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
  const [byStatus, byFlag] = await Promise.all([
    db.collection('clients').where('status', '==', 'booked').select(...READ).get(),
    db.collection('clients').where('isBooked', '==', true).select(...READ).get(),
  ]);
  const byId = new Map();
  [...byStatus.docs, ...byFlag.docs].forEach((d) => byId.set(d.id, d));

  const why = { alreadyHasField: 0, noBookingDate: 0, olderThan90Days: 0, refundedOrDeleted: 0 };
  const rows = [];
  for (const d of byId.values()) {
    const c = d.data();
    if (c.autoFollowUp) { why.alreadyHasField++; continue; }
    const bookings = Object.values((c.accounting && c.accounting.bookings) || {});
    if (bookings.length && !bookings.some((b) => b && b.status === 'ACTIVE')) { why.refundedOrDeleted++; continue; }
    const anchor = auto.bookingAnchor(c);
    if (!anchor) { why.noBookingDate++; continue; }
    if (!auto.isRecentBooking(anchor, now)) { why.olderThan90Days++; continue; }
    const patch = auto.planEnableAutoFollowUp(c, { now, anchor, by: 'system:backfill', byName: 'تشغيل أولي (حجوزات آخر 3 شهور)', via: 'backfill' }, FV.delete());
    if (!patch) continue;
    const old = {}; FIELDS.forEach((f) => { if (c[f] !== undefined) old[f] = c[f]; });
    const keptDate = !('nextFollowUpDate' in patch);
    rows.push({ id: d.id, agentId: c.salesAgentId || '', agent: c.salesAgentName || '', bookedOn: day(anchor), next: keptDate ? null : day(patch.nextFollowUpDate), keptDate, old, patch,
      new: { nextFollowUpDate: keptDate ? (c.nextFollowUpDate || 0) : patch.nextFollowUpDate } });
  }

  const perAgent = {}; const perDay = {};
  rows.forEach((r) => {
    perAgent[r.agent || '(no agent)'] = (perAgent[r.agent || '(no agent)'] || 0) + 1;
    if (r.next) perDay[r.next] = (perDay[r.next] || 0) + 1;
  });
  console.log(`booked clients read: ${byId.size}; to switch on: ${rows.length} (keeping an existing person/AI date: ${rows.filter((r) => r.keptDate).length})`);
  console.log('skipped:', why);
  console.log('per sales person:', perAgent);
  console.log('first automatic date per day:', Object.fromEntries(Object.entries(perDay).sort()));
  console.log('sample (no names/phones):', rows.slice(0, 10).map((r) => ({ id: r.id, agent: r.agent, bookedOn: r.bookedOn, next: r.next || 'kept existing date' })));
  if (!EXECUTE) { console.log('dry run, nothing written (pass --execute)'); return; }
  if (!rows.length) { console.log('nothing to do'); return; }

  // Backup first: the old value of every field this run changes (absent = did not exist).
  const dir = path.join(process.env.HOME || '.', 'backups'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `auto-followups-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: now, project: PROJECT, reason: 'enable automatic 2-week follow-up for bookings of the last 90 days', count: rows.length,
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
  await db.collection('logs').add({ userId: 'system:backfill', userName: 'سكريبت تشغيل المتابعة التلقائية', action: `تشغيل المتابعة التلقائية كل أسبوعين لـ ${done} عميل حاجز (آخر 3 شهور). النسخة الاحتياطية: ${path.basename(file)}`,
    targetId: 'BACKFILL', targetName: 'auto follow-ups', timestamp: Date.now() });
  console.log(`done. undo: node scripts/enable-auto-followups.cjs --restore=${file}`);
})().catch((e) => { console.error(e); process.exit(1); });
