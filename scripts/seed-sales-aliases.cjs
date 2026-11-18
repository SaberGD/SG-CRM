// Seeds app_settings/salesNameAliases, the map the Cloud Functions use to turn a sales name
// written by another system (accounting's salesName, n8n's sales_rep_name) into a CRM user:
//   { aliases: { "<name as the other system writes it>": "<CRM user uid, or the CRM user's name>" } }
// Staff names do not belong in this public repo, so the alias JSON stays in a LOCAL file
// (never commit it). The file may be { "aliases": { ... } } or the bare map.
//
//   node scripts/seed-sales-aliases.cjs /path/outside/repo/aliases.json            dry run (default)
//   node scripts/seed-sales-aliases.cjs /path/outside/repo/aliases.json --apply    writes the doc
//   node scripts/seed-sales-aliases.cjs --restore=/path/to/backup.json [--apply]   puts a backup back
//
// Prints counts only (no names). Before writing, the current doc is saved to
// ~/backups/sales-aliases-<time>.json (restore with --restore=). Credentials: KEY=<service
// account json> or GOOGLE_APPLICATION_CREDENTIALS; ADMIN_PATH may point at firebase-admin.
const fs = require('fs');
const path = require('path');
const { normalizeAliasMap } = require(path.join(__dirname, '..', 'functions', 'agentMatch.js'));

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const restoreArg = args.find((a) => a.startsWith('--restore='));
const input = args.find((a) => !a.startsWith('--'));
const DOC = 'app_settings/salesNameAliases';

function fail(msg) { console.error(msg); process.exit(1); }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(`cannot read JSON from the given file (${e.code || e.name})`); }
}

(async () => {
  if (!input && !restoreArg) fail('usage: node scripts/seed-sales-aliases.cjs <aliases.json> [--apply] | --restore=<backup.json> [--apply]');
  const repoRoot = path.resolve(__dirname, '..');
  if (input && path.resolve(input).startsWith(repoRoot + path.sep)) fail('keep the alias file OUTSIDE the repo (it holds staff names).');

  const admin = require(process.env.ADMIN_PATH || 'firebase-admin');
  const options = { projectId: 'sg-crm-e3a38' };
  if (process.env.KEY) options.credential = admin.credential.cert(require(path.resolve(process.env.KEY)));
  admin.initializeApp(options);
  const db = admin.firestore();
  const ref = db.doc(DOC);

  const currentSnap = await ref.get();
  const current = currentSnap.exists ? currentSnap.data() : null;
  const currentMap = normalizeAliasMap(current);

  let next;
  if (restoreArg) {
    const backup = readJson(restoreArg.slice('--restore='.length));
    next = backup && backup.doc ? backup.doc : null;
    console.log(`restore: backup has ${next ? normalizeAliasMap(next).size : 0} aliases; live doc has ${currentMap.size}`);
  } else {
    const map = normalizeAliasMap(readJson(input));
    const raw = readJson(input);
    const rawCount = Object.keys(raw && raw.aliases && typeof raw.aliases === 'object' ? raw.aliases : raw || {}).length;
    next = { aliases: Object.fromEntries(map), updatedAt: Date.now(), updatedBy: 'script:seed-sales-aliases' };
    const usersSnap = await db.collection('users').select().get();
    const uids = new Set(usersSnap.docs.map((d) => d.id));
    const values = [...map.values()];
    const added = [...map.keys()].filter((k) => !currentMap.has(k)).length;
    const changed = [...map.keys()].filter((k) => currentMap.has(k) && currentMap.get(k) !== map.get(k)).length;
    const removed = [...currentMap.keys()].filter((k) => !map.has(k)).length;
    console.log(JSON.stringify({
      inFile: rawCount, valid: map.size, droppedInvalid: rawCount - map.size,
      targetsThatAreUids: values.filter((v) => uids.has(v)).length, targetsByName: values.filter((v) => !uids.has(v)).length,
      liveDocExists: !!current, liveAliases: currentMap.size, added, changed, removed,
    }));
  }

  if (!APPLY) { console.log('dry run: nothing written (add --apply to write).'); return; }

  const dir = path.join(process.env.HOME || '.', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const backupFile = path.join(dir, `sales-aliases-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ path: DOC, savedAt: Date.now(), doc: current }), { mode: 0o600 });
  console.log(`backup of the live doc written (${current ? currentMap.size : 0} aliases): ${backupFile}`);

  if (next) await ref.set(next);
  else await ref.delete();
  console.log(next ? `written: ${normalizeAliasMap(next).size} aliases` : 'doc removed (backup had no doc)');
})().catch((e) => fail(`failed: ${e.message}`));
