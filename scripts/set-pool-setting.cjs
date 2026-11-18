// Writes app_settings/pool { uid } = the shared pool account the automation parks unassigned
// leads on. The new Firestore rules read it to let sales see and "assign to me" pool clients.
// Must run BEFORE the new rules are deployed (without it sales see no pool clients).
//
//   KEY=/path/to/service-account.json node scripts/set-pool-setting.cjs              (dry run)
//   KEY=... node scripts/set-pool-setting.cjs --execute
//   KEY=... node scripts/set-pool-setting.cjs --restore=<backup file>
// The pool account is found by its email (utils/poolAgent.ts). --execute first saves the
// current doc (or "missing") to ~/backups/pool-setting-<time>.json; --restore puts it back.
const fs = require('fs');
const os = require('os');
const path = require('path');
const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
const PROJECT = 'sg-crm-e3a38';
const KEY = process.env.KEY;
admin.initializeApp(KEY ? { credential: admin.credential.cert(require(path.resolve(KEY))), projectId: PROJECT } : { projectId: PROJECT });
const db = admin.firestore();
const POOL_EMAIL = fs.readFileSync(path.join(__dirname, '..', 'utils', 'poolAgent.ts'), 'utf8').match(/POOL_AGENT_EMAIL = '([^']+)'/)[1];
const execute = process.argv.includes('--execute');
const restore = (process.argv.find((a) => a.startsWith('--restore=')) || '').slice(10);

(async () => {
  const ref = db.doc('app_settings/pool');
  if (restore) {
    const b = JSON.parse(fs.readFileSync(restore, 'utf8'));
    if (b.missing) await ref.delete(); else await ref.set(b.data);
    console.log('restored', b.missing ? '(deleted, was missing)' : '(previous value)');
    return;
  }
  const users = await db.collection('users').where('email', '==', POOL_EMAIL.toLowerCase()).get();
  if (users.size !== 1) { console.log(`expected exactly 1 pool user, found ${users.size}; nothing written`); process.exit(1); }
  const uid = users.docs[0].id;
  const cur = await ref.get();
  const same = cur.exists && cur.data().uid === uid;
  const clients = await db.collection('clients').where('salesAgentId', '==', uid).count().get();
  console.log(`pool user found; clients on the pool: ${clients.data().count}; setting ${same ? 'already correct' : cur.exists ? 'differs' : 'missing'}`);
  if (same || !execute) { if (!execute) console.log('dry run: nothing written (use --execute)'); return; }
  const dir = path.join(os.homedir(), 'backups'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pool-setting-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(cur.exists ? { data: cur.data() } : { missing: true }));
  await ref.set({ uid, updatedAt: Date.now() }, { merge: true });
  console.log('written; backup:', file);
})().catch((e) => { console.error(e.message); process.exit(1); });
