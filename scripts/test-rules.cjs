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

// Shared pool account (app_settings/pool { uid: 'pool' }) and client docs looked up by follow-up create.
const poolM = [
  { function: 'exists', args: [{ exactValue: doc('app_settings/pool') }], result: { value: true } },
  { function: 'get', args: [{ exactValue: doc('app_settings/pool') }], result: { value: { data: { uid: 'pool' } } } },
];
const clientDoc = (id, data) => [
  { function: 'exists', args: [{ exactValue: doc(`clients/${id}`) }], result: { value: true } },
  { function: 'get', args: [{ exactValue: doc(`clients/${id}`) }], result: { value: { data } } },
];
const sales = authOf('s1', 'sales@x.com'); const salesP = [...profile('s1', { role: 'sales_agent', email: 'sales@x.com' }), ...poolM];
const lead = authOf('l1', 'lead@x.com'); const leadP = [...profile('l1', { role: 'team_leader', email: 'lead@x.com' }), ...poolM];
const admin = authOf('a1', 'admin@x.com'); const adminP = profile('a1', { role: 'admin', email: 'admin@x.com' });
const sup = authOf('m1', 'sup@x.com'); const supP = profile('m1', { role: 'supervisor' });
const stranger = authOf('z9', 'stranger@gmail.com'); const strangerP = noProfile('z9');
const deact = authOf('d1', 'old@x.com'); const deactP = profile('d1', { role: 'sales_agent', isDeactivated: true });
const owner = authOf('o1', 'saber.gd.fl@gmail.com');

const NOW = Date.now();
const T = (name, expectation, method, p, auth, mocks, extra = {}) => ({ name, tc: { expectation, request: { method, path: doc(p), auth, time: new Date(NOW).toISOString(), ...(extra.incoming ? { resource: { data: extra.incoming } } : {}) }, ...(extra.existing ? { resource: { data: extra.existing } } : {}), functionMocks: mocks } });
const shift0 = { userId: 's1', userName: 'S', date: '2026-11-18', createdAt: NOW - 3600000, status: 'reviewing', preShiftReviewStartedAt: NOW - 3600000, breaks: [] };
const shiftA = { ...shift0, status: 'active', startedAt: NOW - 3000000, preShiftReviewDurationMs: 600000 };
const brk1 = { startedAt: NOW - 2000000, endedAt: NOW - 1000000, lateMinutes: 0 };

const cases = [
  T('stranger (Google only) cannot read clients', 'DENY', 'get', 'clients/c1', stranger, strangerP, { existing: { salesAgentId: 's1' } }),
  T('stranger cannot read users', 'DENY', 'get', 'users/s1', stranger, strangerP, { existing: { role: 'admin' } }),
  T('anonymous cannot read invitations', 'DENY', 'get', 'invitations/i1', undefined, [], { existing: { email: 'a@b.c' } }),
  T('deactivated user cannot read clients', 'DENY', 'get', 'clients/c1', deact, deactP, { existing: { salesAgentId: 's1' } }),
  T('sales cannot read another agent\'s client', 'DENY', 'get', 'clients/c1', sales, salesP, { existing: { salesAgentId: 'other' } }),
  T('sales reads own client', 'ALLOW', 'get', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1' } }),
  T('sales reads a pool client', 'ALLOW', 'get', 'clients/c1', sales, salesP, { existing: { salesAgentId: 'pool' } }),
  T('leader reads any client', 'ALLOW', 'get', 'clients/c1', lead, leadP, { existing: { salesAgentId: 'other' } }),
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
  T('sales cannot edit money of an accounting-linked client', 'DENY', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1', accountingBookingIds: ['b1'], paidAmount: 800 }, incoming: { salesAgentId: 's1', accountingBookingIds: ['b1'], paidAmount: 5000 } }),
  T('sales can still edit other fields of an accounting-linked client', 'ALLOW', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1', accountingBookingIds: ['b1'], notes: 'a', paidAmount: 800 }, incoming: { salesAgentId: 's1', accountingBookingIds: ['b1'], notes: 'b', paidAmount: 800 } }),
  T('staff can read feature switches', 'ALLOW', 'get', 'app_settings/assistant', sales, salesP, { existing: { enabled: true } }),
  T('sales cannot change feature switches', 'DENY', 'update', 'app_settings/assistant', sales, salesP, { existing: { enabled: false }, incoming: { enabled: true } }),
  T('sync_review is manager-only', 'DENY', 'get', 'sync_review/x', sales, salesP, { existing: { reason: 'x' } }),
  T('sales cannot write aiRecommendation', 'DENY', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1' }, incoming: { salesAgentId: 's1', aiRecommendation: { status: 'ACCEPTED' } } }),
  T('sales cannot write the client 360 snapshot', 'DENY', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1' }, incoming: { salesAgentId: 's1', snapshot360: { briefing: 'x' } } }),
  T('sales cannot write courseEndsAt / alumniDue / multiCourse', 'DENY', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1' }, incoming: { salesAgentId: 's1', multiCourse: true } }),
  T('leader cannot write snapshot360 from the browser either', 'DENY', 'update', 'clients/c1', lead, leadP, { existing: { salesAgentId: 's1' }, incoming: { salesAgentId: 's1', snapshot360: { briefing: 'x' } } }),
  T('owner agent can mark the client as alumni', 'ALLOW', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1' }, incoming: { salesAgentId: 's1', isAlumni: true, alumniSince: 1 } }),
  T('another agent cannot mark someone else\'s client as alumni', 'DENY', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 'other' }, incoming: { salesAgentId: 'other', isAlumni: true } }),
  T('sales cannot create a client with a snapshot360', 'DENY', 'create', 'clients/new', sales, salesP, { incoming: { salesAgentId: 's1', name: 'n', snapshot360: { briefing: 'x' } } }),
  T('sales cannot create a client with multiCourse / courseEndsAt', 'DENY', 'create', 'clients/new', sales, salesP, { incoming: { salesAgentId: 's1', name: 'n', multiCourse: true, courseEndsAt: '2026-12-01' } }),
  T('sales creates a client for self', 'ALLOW', 'create', 'clients/new', sales, salesP, { incoming: { salesAgentId: 's1', name: 'n' } }),
  T('sales cannot create a client for someone else', 'DENY', 'create', 'clients/new', sales, salesP, { incoming: { salesAgentId: 'other', name: 'n' } }),
  T('sales cannot delete clients', 'DENY', 'delete', 'clients/c1', sales, salesP, { existing: { salesAgentId: 's1' } }),
  T('owner account can do anything (update any client)', 'ALLOW', 'update', 'clients/c1', owner, noProfile('o1'), { existing: { salesAgentId: 's1' }, incoming: { salesAgentId: 'x', accountingBookingIds: ['b'] } }),
  T('sales logs a follow-up as self', 'ALLOW', 'create', 'followups/f1', sales, [...salesP, ...clientDoc('c1', { salesAgentId: 's1' })], { incoming: { agentId: 's1', clientId: 'c1' } }),
  T('sales cannot log a follow-up as someone else', 'DENY', 'create', 'followups/f1', sales, salesP, { incoming: { agentId: 'other' } }),
  T('sales cannot edit services', 'DENY', 'create', 'services/sv1', sales, salesP, { incoming: { name: 'x' } }),
  T('supervisor can edit services', 'ALLOW', 'create', 'services/sv1', sup, supP, { incoming: { name: 'x' } }),
  T('admin can archive merged clients', 'ALLOW', 'create', 'merged_clients/m1', owner, noProfile('o1'), { incoming: { mergedInto: 'x' } }),
  T('sales cannot touch merge archive', 'DENY', 'get', 'merged_clients/m1', sales, salesP, { existing: { mergedInto: 'x' } }),
  T('stranger cannot read shifts or logs', 'DENY', 'get', 'logs/l1', stranger, strangerP, { existing: { userId: 'a' } }),

  // --- invitations: only admins hand out non-sales roles ---
  T('leader cannot write an admin invitation mirror', 'DENY', 'create', 'allowed_users/x@y.com', lead, leadP, { incoming: { email: 'x@y.com', role: 'admin', isActive: true } }),
  T('leader cannot write a manager invitation mirror', 'DENY', 'create', 'allowed_users/x@y.com', lead, leadP, { incoming: { email: 'x@y.com', role: 'manager', isActive: true } }),
  T('supervisor cannot write an admin invitation mirror', 'DENY', 'create', 'allowed_users/x@y.com', sup, supP, { incoming: { email: 'x@y.com', role: 'admin', isActive: true } }),
  T('leader can invite a sales agent', 'ALLOW', 'create', 'allowed_users/x@y.com', lead, leadP, { incoming: { email: 'x@y.com', role: 'sales_agent', isActive: true } }),
  T('leader cannot upgrade a sales invitation to admin', 'DENY', 'update', 'allowed_users/x@y.com', lead, leadP, { existing: { role: 'sales_agent', isActive: true }, incoming: { role: 'admin', isActive: true } }),
  T('leader cannot remove an admin invitation', 'DENY', 'delete', 'allowed_users/x@y.com', lead, leadP, { existing: { role: 'admin', isActive: true } }),
  T('admin can write an admin invitation mirror', 'ALLOW', 'create', 'allowed_users/x@y.com', admin, adminP, { incoming: { email: 'x@y.com', role: 'admin', isActive: true } }),
  T('admin can deactivate an invitation', 'ALLOW', 'update', 'allowed_users/x@y.com', admin, adminP, { existing: { role: 'manager', isActive: true }, incoming: { role: 'manager', isActive: false } }),
  T('leader cannot create a manager invitation', 'DENY', 'create', 'invitations/i2', lead, leadP, { incoming: { email: 'x@y.com', role: 'manager', status: 'pending' } }),
  T('leader can create a sales invitation', 'ALLOW', 'create', 'invitations/i2', lead, leadP, { incoming: { email: 'x@y.com', role: 'sales_agent', status: 'pending' } }),
  T('deactivated invitation cannot create a profile', 'DENY', 'create', 'users/z9', stranger, [...strangerP, ...invite('stranger@gmail.com', { role: 'sales_agent', isActive: false })], { incoming: { email: 'stranger@gmail.com', role: 'sales_agent', name: 'x' } }),

  // --- logs ---
  T('sales logs in own name', 'ALLOW', 'create', 'logs/l2', sales, salesP, { incoming: { userId: 's1', userName: 'S', action: 'x', timestamp: NOW } }),
  T('sales cannot log in someone else\'s name', 'DENY', 'create', 'logs/l2', sales, salesP, { incoming: { userId: 'other', userName: 'O', action: 'x', timestamp: NOW } }),

  // --- client create: server fields blocked ---
  T('sales cannot create a client with accounting fields', 'DENY', 'create', 'clients/new', sales, salesP, { incoming: { salesAgentId: 's1', name: 'n', accountingBookingIds: ['b1'] } }),
  T('sales cannot create a client with an aiRecommendation', 'DENY', 'create', 'clients/new', sales, salesP, { incoming: { salesAgentId: 's1', name: 'n', aiRecommendation: { status: 'PENDING' } } }),

  // --- assign to me from the pool ---
  T('sales takes a pool client for self', 'ALLOW', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 'pool', salesAgentName: 'Pool', name: 'n' }, incoming: { salesAgentId: 's1', salesAgentName: 'S', name: 'n' } }),
  T('sales cannot give a pool client to someone else', 'DENY', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 'pool', name: 'n' }, incoming: { salesAgentId: 'other', name: 'n' } }),
  T('taking a pool client cannot change other fields', 'DENY', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 'pool', name: 'n', status: 'potential' }, incoming: { salesAgentId: 's1', name: 'n', status: 'booked' } }),
  T('sales cannot take another agent\'s client', 'DENY', 'update', 'clients/c1', sales, salesP, { existing: { salesAgentId: 'other', name: 'n' }, incoming: { salesAgentId: 's1', name: 'n' } }),
  T('sales records own claim from the pool', 'ALLOW', 'create', 'transfers/t1', sales, salesP, { incoming: { oldAgentId: 'pool', newAgentId: 's1', clientId: 'c1' } }),
  T('sales cannot record a transfer between others', 'DENY', 'create', 'transfers/t1', sales, salesP, { incoming: { oldAgentId: 'other', newAgentId: 's1', clientId: 'c1' } }),

  // --- follow-ups: scoped reads, creates only on visible clients ---
  T('sales reads a follow-up they wrote', 'ALLOW', 'get', 'followups/f1', sales, salesP, { existing: { agentId: 's1', clientAgentId: 'other' } }),
  T('sales reads a follow-up of their own client', 'ALLOW', 'get', 'followups/f1', sales, salesP, { existing: { agentId: 'other', clientAgentId: 's1' } }),
  T('sales cannot read another agent\'s follow-up', 'DENY', 'get', 'followups/f1', sales, salesP, { existing: { agentId: 'other', clientAgentId: 'other' } }),
  T('leader reads any follow-up', 'ALLOW', 'get', 'followups/f1', lead, leadP, { existing: { agentId: 'other', clientAgentId: 'other' } }),
  T('sales logs a follow-up on their own client', 'ALLOW', 'create', 'followups/f2', sales, [...salesP, ...clientDoc('c1', { salesAgentId: 's1' })], { incoming: { agentId: 's1', clientId: 'c1', clientAgentId: 's1' } }),
  T('sales cannot log a follow-up on another agent\'s client', 'DENY', 'create', 'followups/f2', sales, [...salesP, ...clientDoc('c2', { salesAgentId: 'other' })], { incoming: { agentId: 's1', clientId: 'c2', clientAgentId: 'other' } }),
  T('sales cannot mark follow-ups checked', 'DENY', 'update', 'followups/f1', sales, salesP, { existing: { agentId: 's1' }, incoming: { agentId: 's1', reviewedBy: 's1' } }),

  // --- reports ---
  T('owner cannot delete their report', 'DENY', 'delete', 'reports/r1', sales, salesP, { existing: { userId: 's1' } }),
  T('supervisor can delete a report', 'ALLOW', 'delete', 'reports/r1', sup, supP, { existing: { userId: 's1' } }),

  // --- shifts: only the normal transitions, timed now ---
  T('sales opens a fresh shift now', 'ALLOW', 'create', 'shifts/sh1', sales, salesP, { incoming: { ...shift0, createdAt: NOW, preShiftReviewStartedAt: NOW } }),
  T('sales cannot open a shift dated in the past', 'DENY', 'create', 'shifts/sh1', sales, salesP, { incoming: { ...shift0, createdAt: NOW - 86400000 } }),
  T('sales cannot open a shift already active', 'DENY', 'create', 'shifts/sh1', sales, salesP, { incoming: { ...shift0, createdAt: NOW, status: 'active', startedAt: NOW - 7200000 } }),
  T('sales cannot open a shift for someone else', 'DENY', 'create', 'shifts/sh1', sales, salesP, { incoming: { ...shift0, userId: 'other', createdAt: NOW } }),
  T('sales starts the shift now', 'ALLOW', 'update', 'shifts/sh1', sales, salesP, { existing: shift0, incoming: { ...shift0, status: 'active', startedAt: NOW, preShiftReviewDurationMs: 3600000 } }),
  T('sales cannot back-date the shift start', 'DENY', 'update', 'shifts/sh1', sales, salesP, { existing: shift0, incoming: { ...shift0, status: 'active', startedAt: NOW - 7200000, preShiftReviewDurationMs: 1 } }),
  T('sales starts a break', 'ALLOW', 'update', 'shifts/sh1', sales, salesP, { existing: { ...shiftA, breaks: [brk1] }, incoming: { ...shiftA, status: 'on_break', breaks: [brk1, { startedAt: NOW }] } }),
  T('sales cannot shorten an earlier break', 'DENY', 'update', 'shifts/sh1', sales, salesP, { existing: { ...shiftA, breaks: [brk1] }, incoming: { ...shiftA, status: 'on_break', breaks: [{ ...brk1, endedAt: brk1.startedAt + 1 }, { startedAt: NOW }] } }),
  T('sales ends the open break now', 'ALLOW', 'update', 'shifts/sh1', sales, salesP, { existing: { ...shiftA, status: 'on_break', breaks: [brk1, { startedAt: NOW - 600000 }] }, incoming: { ...shiftA, status: 'active', breaks: [brk1, { startedAt: NOW - 600000, endedAt: NOW, lateMinutes: 0 }] } }),
  T('sales cannot move the break start', 'DENY', 'update', 'shifts/sh1', sales, salesP, { existing: { ...shiftA, status: 'on_break', breaks: [{ startedAt: NOW - 600000 }] }, incoming: { ...shiftA, status: 'active', breaks: [{ startedAt: NOW - 60000, endedAt: NOW }] } }),
  T('sales ends the shift now', 'ALLOW', 'update', 'shifts/sh1', sales, salesP, { existing: shiftA, incoming: { ...shiftA, status: 'ended', endedAt: NOW } }),
  T('sales cannot reopen an ended shift', 'DENY', 'update', 'shifts/sh1', sales, salesP, { existing: { ...shiftA, status: 'ended', endedAt: NOW - 1000 }, incoming: { ...shiftA, status: 'active' } }),
  T('sales cannot change the shift date', 'DENY', 'update', 'shifts/sh1', sales, salesP, { existing: shiftA, incoming: { ...shiftA, date: '2026-11-01' } }),
  T('sales links the day\'s report', 'ALLOW', 'update', 'shifts/sh1', sales, salesP, { existing: shiftA, incoming: { ...shiftA, reportId: 'r1' } }),
  T('supervisor can edit a shift', 'ALLOW', 'update', 'shifts/sh1', sup, supP, { existing: shiftA, incoming: { ...shiftA, startedAt: NOW - 9000000 } }),
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
