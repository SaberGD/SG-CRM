// Tests firestore.rules against the live Firebase Rules API (no emulator/Java needed).
// usage: GOOGLE_APPLICATION_CREDENTIALS=... node scripts/test-rules.cjs [rulesFile]
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require(process.env.GAUTH_PATH || 'google-auth-library');
const PROJECT = process.env.PROJECT || 'sg-crm-e3a38';
const rules = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const D = '/databases/(default)/documents';
const doc = (p) => `${D}/${p}`;

const authOf = (uid, email, verified = true) => ({ uid, token: { email, email_verified: verified } });
const profile = (uid, data) => [
  { function: 'exists', args: [{ exactValue: doc(`users/${uid}`) }], result: { value: true } },
  { function: 'get', args: [{ exactValue: doc(`users/${uid}`) }], result: { value: { data } } },
];
const noProfile = (uid) => [{ function: 'exists', args: [{ exactValue: doc(`users/${uid}`) }], result: { value: false } }];
const invite = (email, data) => [
  { function: 'exists', args: [{ exactValue: doc(`allowed_users/${email}`) }], result: { value: true } },
  { function: 'get', args: [{ exactValue: doc(`allowed_users/${email}`) }], result: { value: { data } } },
];
const noInvite = (email) => [{ function: 'exists', args: [{ exactValue: doc(`allowed_users/${email}`) }], result: { value: false } }];

const sales = authOf('s1', 'sales@x.com'); const salesP = profile('s1', { role: 'sales_agent', email: 'sales@x.com' });
const lead = authOf('l1', 'lead@x.com'); const leadP = profile('l1', { role: 'team_leader', email: 'lead@x.com' });
const sup = authOf('m1', 'sup@x.com'); const supP = profile('m1', { role: 'supervisor' });
const stranger = authOf('z9', 'stranger@gmail.com'); const strangerP = noProfile('z9');
const deact = authOf('d1', 'old@x.com'); const deactP = profile('d1', { role: 'sales_agent', isDeactivated: true });
const owner = authOf('o1', 'saber.gd.fl@gmail.com');

const T = (name, expectation, method, p, auth, mocks, extra = {}) => ({ name, tc: { expectation, request: { method, path: doc(p), auth, ...(extra.incoming ? { resource: { data: extra.incoming } } : {}) }, ...(extra.existing ? { resource: { data: extra.existing } } : {}), functionMocks: mocks } });

const cases = [
  T('stranger (Google only) cannot read clients', 'DENY', 'get', 'clients/c1', stranger, strangerP, { existing: { salesAgentId: 's1' } }),
  T('stranger cannot read users', 'DENY', 'get', 'users/s1', stranger, strangerP, { existing: { role: 'admin' } }),
  T('anonymous cannot read invitations', 'DENY', 'get', 'invitations/i1', undefined, [], { existing: { email: 'a@b.c' } }),
  T('deactivated user cannot read clients', 'DENY', 'get', 'clients/c1', deact, deactP, { existing: { salesAgentId: 's1' } }),
  T('active sales can read clients', 'ALLOW', 'get', 'clients/c1', sales, salesP, { existing: { salesAgentId: 'other' } }),
  T('stranger cannot self-create admin profile', 'DENY', 'create', 'users/z9', stranger, [...strangerP, ...noInvite('stranger@gmail.com')], { incoming: { email: 'stranger@gmail.com', role: 'admin', name: 'x' } }),
  T('uninvited stranger cannot self-create sales profile', 'DENY', 'create', 'users/z9', stranger, [...strangerP, ...noInvite('stranger@gmail.com')], { incoming: { email: 'stranger@gmail.com', role: 'sales_agent', name: 'x' } }),
  T('invited person can create their profile with the invited role', 'ALLOW', 'create', 'users/z9', stranger, [...strangerP, ...invite('stranger@gmail.com', { role: 'sales_agent', isActive: true })], { incoming: { email: 'stranger@gmail.com', role: 'sales_agent', name: 'x' } }),
  T('invited sales cannot claim admin', 'DENY', 'create', 'users/z9', stranger, [...strangerP, ...invite('stranger@gmail.com', { role: 'sales_agent', isActive: true })], { incoming: { email: 'stranger@gmail.com', role: 'admin', name: 'x' } }),
  T('owner account can create its admin profile', 'ALLOW', 'create', 'users/o1', owner, noProfile('o1'), { incoming: { email: 'saber.gd.fl@gmail.com', role: 'admin', name: 'x' } }),
  T('user cannot change own role', 'DENY', 'update', 'users/s1', sales, salesP, { existing: { role: 'sales_agent', email: 'sales@x.com', name: 'a' }, incoming: { role: 'admin', email: 'sales@x.com', name: 'a' } }),
  T('user can change own name', 'ALLOW', 'update', 'users/s1', sales, salesP, { existing: { role: 'sales_agent', email: 'sales@x.com', name: 'a' }, incoming: { role: 'sales_agent', email: 'sales@x.com', name: 'b' } }),
  T('sales cannot read invitations of others', 'DENY', 'get', 'invitations/i1', sales, salesP, { existing: { email: 'other@x.com' } }),
  T('invited person can read their own invitation', 'ALLOW', 'get', 'invitations/i1', sales, salesP, { existing: { email: 'sales@x.com' } }),
  T('team leader can read invitations', 'ALLOW', 'get', 'invitations/i1', lead, leadP, { existing: { email: 'other@x.com' } }),
  T('sales updates own client', 'ALLOW', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1', note: 'a' }, incoming: { salesAgentId: 's1', note: 'b' } }),
  T('sales cannot update someone else\'s client', 'DENY', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 'other', note: 'a' }, incoming: { salesAgentId: 'other', note: 'b' } }),
  T('sales cannot hand off own client', 'DENY', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1' }, incoming: { salesAgentId: 'other' } }),
  T('leader can transfer a client', 'ALLOW', 'update', 'clients/c1', lead, leadP, { existing: { salesAgentId: 's1' }, incoming: { salesAgentId: 'other' } }),
  T('sales cannot write accounting-synced fields', 'DENY', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1' }, incoming: { salesAgentId: 's1', accountingBookingIds: ['b1'] } }),
  T('sales cannot write aiRecommendation', 'DENY', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1' }, incoming: { salesAgentId: 's1', aiRecommendation: { status: 'ACCEPTED' } } }),
  T('sales creates a client for self', 'ALLOW', 'create', 'clients/new', sales, salesP, { incoming: { salesAgentId: 's1', name: 'n' } }),
  T('sales cannot create a client for someone else', 'DENY', 'create', 'clients/new', sales, salesP, { incoming: { salesAgentId: 'other', name: 'n' } }),
  T('sales cannot delete clients', 'DENY', 'delete', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1' } }),
  T('owner account can do anything (update any client)', 'ALLOW', 'update', 'clients/c1', owner, noProfile('o1'), { existing: { salesAgentId: 's1' }, incoming: { salesAgentId: 'x', accountingBookingIds: ['b'] } }),
  T('sales logs a follow-up as self', 'ALLOW', 'create', 'followups/f1', sales, salesP, { incoming: { agentId: 's1' } }),
  T('sales cannot log a follow-up as someone else', 'DENY', 'create', 'followups/f1', sales, salesP, { incoming: { agentId: 'other' } }),
  T('sales cannot edit services', 'DENY', 'create', 'services/sv1', sales, salesP, { incoming: { name: 'x' } }),
  T('supervisor can edit services', 'ALLOW', 'create', 'services/sv1', sup, supP, { incoming: { name: 'x' } }),
  T('stranger cannot read shifts or logs', 'DENY', 'get', 'logs/l1', stranger, strangerP, { existing: { userId: 'a' } }),
];

(async () => {
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const res = await client.request({
    url: `https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, method: 'POST',
    data: { source: { files: [{ name: 'firestore.rules', content: rules }] }, testSuite: { testCases: cases.map((c) => c.tc) } },
  });
  const issues = res.data.issues || [];
  if (issues.length) { console.log('RULE COMPILE ISSUES:', JSON.stringify(issues).slice(0, 600)); process.exit(2); }
  const results = res.data.testResults || [];
  let fail = 0;
  results.forEach((r, i) => {
    const ok = r.state === 'SUCCESS';
    if (!ok) { fail++; console.log('FAIL:', cases[i].name, '->', r.state, (r.errorPosition ? JSON.stringify(r.errorPosition) : ''), (r.debugMessages || []).slice(0, 2).join(' | ')); }
  });
  console.log(`${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERR', String(e.response?.data ? JSON.stringify(e.response.data) : e.message).slice(0, 500)); process.exit(3); });
