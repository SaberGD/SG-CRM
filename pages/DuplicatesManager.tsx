import React, { useEffect, useMemo, useState } from 'react';
import * as firestore from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { Client, UserRole } from '../types';
import { GitMerge, CheckCircle2, AlertTriangle } from 'lucide-react';
import { normalizeName, normalizePhoneKey, planMerge } from '../utils/clientMerge.mjs';

type Group = { phoneKey: string; clients: Client[] };
const REASONS: Record<string, string> = {
  multiple_agents: 'العميل عند أكتر من سيلز حقيقي',
  financial_conflict: 'حجزين بأسعار مختلفة',
};

// Admin page: merges clients that share a phone number. Every removed record is
// archived in merged_clients first and its follow-ups are moved to the kept record.
const DuplicatesManager: React.FC = () => {
  const { user, effectiveRole } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [followupCounts, setFollowupCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [primaryPick, setPrimaryPick] = useState<Record<string, string>>({});
  const isAdmin = effectiveRole === UserRole.ADMIN;

  const load = async () => {
    setLoading(true);
    const [cs, fs] = await Promise.all([
      firestore.getDocs(firestore.collection(db, 'clients')),
      firestore.getDocs(firestore.collection(db, 'followups')),
    ]);
    setClients(cs.docs.map((d) => ({ id: d.id, ...d.data() } as Client)));
    const counts: Record<string, number> = {};
    fs.docs.forEach((d) => { const id = (d.data() as any).clientId; counts[id] = (counts[id] || 0) + 1; });
    setFollowupCounts(counts);
    setLoading(false);
  };
  useEffect(() => { if (isAdmin) load().catch((e) => { console.error(e); setLoading(false); }); }, [isAdmin]);

  const poolAgentIds = useMemo(() => new Set(clients
    .filter((c) => /^(Saber Group|saber\.gd\.fl|مستخدم \(محدود\))$/.test(c.salesAgentName || ''))
    .map((c) => c.salesAgentId)), [clients]);

  const groups: Group[] = useMemo(() => {
    const m = new Map<string, Client[]>();
    clients.forEach((c) => { const k = normalizePhoneKey(c.phone); if (k) (m.get(k) || m.set(k, []).get(k)!).push(c); });
    return [...m.entries()].filter(([, g]) => g.length > 1).map(([phoneKey, g]) => ({ phoneKey, clients: g }));
  }, [clients]);

  const rows = useMemo(() => groups.map((g) => {
    const sameName = g.clients.every((c) => normalizeName(c.name) === normalizeName(g.clients[0].name));
    const plan = planMerge(g.clients as any[], { followupCounts, poolAgentIds });
    return { g, sameName, plan };
  }), [groups, followupCounts, poolAgentIds]);

  const safe = rows.filter((r) => r.sameName && r.plan.ok);
  const review = rows.filter((r) => !(r.sameName && r.plan.ok));

  const mergeGroup = async (g: Group, forcedPrimary?: string) => {
    let group = g.clients as any[];
    let plan = planMerge(group, { followupCounts, poolAgentIds });
    if (forcedPrimary) {
      // Manual choice: put the chosen client first so it wins every tie-break.
      group = [group.find((c) => c.id === forcedPrimary), ...group.filter((c) => c.id !== forcedPrimary)];
      plan = { ...planMerge(group, { followupCounts, poolAgentIds }), primaryId: forcedPrimary } as any;
      if (!plan.ok) plan = { ok: true, primaryId: forcedPrimary, duplicateIds: group.filter((c) => c.id !== forcedPrimary).map((c) => c.id), patch: { mergedFromIds: group.filter((c) => c.id !== forcedPrimary).map((c) => c.id) } };
    }
    if (!plan.ok || !plan.primaryId || !plan.duplicateIds) return false;
    const byId = Object.fromEntries(group.map((c) => [c.id, c]));
    const primary = byId[plan.primaryId];
    const batch = firestore.writeBatch(db);
    batch.update(firestore.doc(db, 'clients', plan.primaryId), { ...(plan.patch || {}), phoneKey: g.phoneKey, phoneKeys: [g.phoneKey] });
    const fsSnap = await firestore.getDocs(firestore.query(firestore.collection(db, 'followups'), firestore.where('clientId', 'in', plan.duplicateIds.slice(0, 10))));
    for (const dupId of plan.duplicateIds) {
      const { id, ...data } = byId[dupId];
      batch.set(firestore.doc(db, 'merged_clients', dupId), { data, mergedInto: plan.primaryId, mergedAt: Date.now(), mergedBy: user?.uid || '' });
      batch.delete(firestore.doc(db, 'clients', dupId));
    }
    fsSnap.docs.forEach((d) => batch.update(d.ref, { clientId: plan.primaryId, clientName: primary.name }));
    batch.set(firestore.doc(firestore.collection(db, 'client_merges')), { primaryId: plan.primaryId, duplicateIds: plan.duplicateIds, at: Date.now(), by: user?.uid || '' });
    await batch.commit();
    return true;
  };

  const run = async (fn: () => Promise<number>, okText: (n: number) => string) => {
    setBusy(true); setMessage('');
    try { const n = await fn(); setMessage(okText(n)); await load(); }
    catch (e: any) { console.error(e); setMessage(`حصل خطأ: ${e?.message || e}`); }
    finally { setBusy(false); }
  };

  const mergeAllSafe = () => {
    if (!confirm(`هيتم دمج ${safe.length} مجموعة (نفس الرقم ونفس الاسم). السجلات الزيادة بتتأرشف وممكن تتسترجع. نكمل؟`)) return;
    run(async () => { let n = 0; for (const r of safe) { if (await mergeGroup(r.g)) n++; } await logActivity(user!.uid, user!.name, `دمج تلقائي لعملاء مكررين (${n} مجموعة)`, 'merge', String(n)); return n; }, (n) => `تم دمج ${n} مجموعة.`);
  };

  if (!isAdmin) return <div className="p-10 text-center font-bold text-slate-500">الصفحة دي للأدمن فقط.</div>;

  return (
    <div className="sg-page space-y-6 animate-fade-in">
      <header className="mb-2">
        <h1>العملاء المكررين</h1>
        <p className="text-sm text-slate-500 mt-1">عملاء بنفس رقم التليفون. الدمج بيحافظ على المتابعات والحجز، والسجل المحذوف بيتأرشف.</p>
      </header>
      {message && <div className="rounded-2xl bg-emerald-50 text-emerald-700 font-bold p-4 text-sm">{message}</div>}
      {loading ? <p className="text-slate-500 font-bold">جاري التحميل…</p> : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="مجموعات مكررة" value={groups.length} />
            <Stat label="دمج آمن (نفس الاسم)" value={safe.length} tone="ok" />
            <Stat label="محتاجة مراجعة" value={review.length} tone="warn" />
          </div>
          <div className="flex gap-3">
            <button disabled={busy || !safe.length} onClick={mergeAllSafe} className="bg-primary-500 text-white px-6 py-3 rounded-2xl font-black text-sm disabled:opacity-50 flex items-center gap-2"><GitMerge size={16} /> دمج كل الآمن ({safe.length})</button>
          </div>
          <section className="space-y-4">
            <h2 className="font-black text-lg">للمراجعة اليدوية</h2>
            {review.length === 0 && <p className="text-slate-500 font-bold flex items-center gap-2"><CheckCircle2 className="text-emerald-500" size={18} /> مفيش حاجة للمراجعة.</p>}
            {review.map(({ g, plan }) => {
              const picked = primaryPick[g.phoneKey] || (plan.ok ? plan.primaryId : g.clients[0].id);
              return (
                <div key={g.phoneKey} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-5">
                  <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                    <div className="text-xs font-black text-slate-400" dir="ltr">…{g.phoneKey}</div>
                    {!plan.ok && <div className="text-xs font-black text-amber-600 flex items-center gap-1"><AlertTriangle size={14} /> {REASONS[plan.reason || ''] || 'الأسماء مختلفة'}</div>}
                  </div>
                  <div className="space-y-2">
                    {g.clients.map((c) => (
                      <label key={c.id} className={`flex items-center gap-3 rounded-2xl border p-3 cursor-pointer ${picked === c.id ? 'border-primary-500 bg-primary-50/40' : 'border-slate-100 dark:border-slate-800'}`}>
                        <input type="radio" name={g.phoneKey} checked={picked === c.id} onChange={() => setPrimaryPick((p) => ({ ...p, [g.phoneKey]: c.id }))} />
                        <div className="flex-1 text-sm"><b>{c.name}</b> · {c.salesAgentName} · {c.status}{c.bookedCourseName ? ` · ${c.bookedCourseName}` : ''}{(c.totalPrice || c.paidAmount) ? ` · ${c.paidAmount || 0}/${c.totalPrice || 0}` : ''} · {followupCounts[c.id] || 0} متابعة</div>
                      </label>
                    ))}
                  </div>
                  <button disabled={busy} onClick={() => confirm('دمج المجموعة دي في السجل المختار؟') && run(async () => ((await mergeGroup(g, picked)) ? 1 : 0), () => 'تم الدمج.')} className="mt-3 bg-slate-900 text-white px-5 py-2 rounded-xl text-xs font-black disabled:opacity-50">دمج في السجل المختار</button>
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; tone?: 'ok' | 'warn' }> = ({ label, value, tone }) => (
  <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-5">
    <div className="text-xs font-black text-slate-400">{label}</div>
    <div className={`text-3xl font-black ${tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : ''}`}>{value}</div>
  </div>
);

export default DuplicatesManager;
