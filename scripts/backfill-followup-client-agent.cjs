// Stamps every follow-up with clientAgentId = the CURRENT owner (salesAgentId) of its client.
// The scoped rules let a sales agent read follow-ups they wrote or whose clientAgentId is theirs
// (or the pool's), so old follow-ups need the field before those rules go live, otherwise an agent
// loses the history their colleagues wrote before a transfer.
//
//   KEY=/path/to/service-account.json node scripts/backfill-followup-client-agent.cjs           (dry run, read only)
//   KEY=... node scripts/backfill-followup-client-agent.cjs --execute
//   KEY=... node scripts/backfill-followup-client-agent.cjs --restore=<journal file> [--force]
//
// --execute first writes ~/backups/followup-client-agent-<time>.json (every follow-up it changes,
// with its previous clientAgentId or null), then updates in batches of 400. Running it again only
// touches follow-ups whose client changed owner since. --restore puts the previous value back
// (deletes the field where there was none), skipping follow-ups whose clientAgentId changed since
// the run unless --force. Prints counts only (no names, no phones).
const fs = require('fs');
const os = require('os');
const path = require('path');
const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
const PROJECT = 'sg-crm-e3a38';
const KEY = process.env.KEY;
admin.initializeApp(KEY ? { credential: admin.credential.cert(require(path.resolve(KEY))), projectId: PROJECT } : { projectId: PROJECT });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const execute = process.argv.includes('--execute');
const force = process.argv.includes('--force');
const restore = (process.argv.find((a) => a.startsWith('--restore=')) || '').slice(10);

async function commitAll(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach(([ref, data]) => batch.update(ref, data));
    await batch.commit();
    console.log(`  committed ${Math.min(i + 400, ops.length)}/${ops.length}`);
  }
}

(async () => {
  if (restore) {
    const journal = JSON.parse(fs.readFileSync(restore, 'utf8'));
    const ops = []; let skipped = 0;
    for (let i = 0; i < journal.items.length; i += 300) {
      const refs = journal.items.slice(i, i + 300).map((it) => db.doc(`followups/${it.id}`));
      const snaps = await db.getAll(...refs);
      snaps.forEach((s, k) => {
        const it = journal.items[i + k];
        if (!s.exists) return;
        if (!force && s.get('clientAgentId') !== it.next) { skipped++; return; }
        ops.push([s.ref, { clientAgentId: it.prev === null ? FV.delete() : it.prev }]);
      });
    }
    console.log(`restore: ${ops.length} to put back, ${skipped} skipped (changed since; --force to override)`);
    await commitAll(ops);
    return;
  }

  const owners = new Map();
  (await db.collection('clients').select('salesAgentId').get()).forEach((d) => owners.set(d.id, d.get('salesAgentId') || ''));
  const fsnap = await db.collection('followups').select('clientId', 'clientAgentId').get();
  const items = []; let noClient = 0, ok = 0;
  fsnap.forEach((d) => {
    const owner = owners.get(d.get('clientId'));
    if (owner === undefined || !owner) { noClient++; return; }
    const prev = d.get('clientAgentId') ?? null;
    if (prev === owner) { ok++; return; }
    items.push({ id: d.id, prev, next: owner });
  });
  console.log(`clients: ${owners.size}; follow-ups: ${fsnap.size}; already right: ${ok}; client missing/unowned: ${noClient}; to stamp: ${items.length}`);
  if (!execute) { console.log('dry run: nothing written (use --execute)'); return; }
  const dir = path.join(os.homedir(), 'backups'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `followup-client-agent-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: Date.now(), items }));
  console.log('journal:', file);
  await commitAll(items.map((it) => [db.doc(`followups/${it.id}`), { clientAgentId: it.next }]));
})().catch((e) => { console.error(e.message); process.exit(1); });
