// Read-only: dumps collections to ~/backups/<dir>/<collection>.json
const admin = require(process.env.ADMIN_PATH || 'firebase-admin'); admin.initializeApp({ projectId: 'sg-crm-e3a38' }); const db = admin.firestore(); const fs = require('fs');
const dir = `${process.env.HOME}/backups/${process.argv[2] || 'crm-backup'}`; fs.mkdirSync(dir, { recursive: true });
(async () => { for (const c of process.argv.slice(3)) { const s = await db.collection(c).get(); fs.writeFileSync(`${dir}/${c}.json`, JSON.stringify(s.docs.map((d) => ({ id: d.id, ...d.data() })))); console.log(c, s.size); } })();
