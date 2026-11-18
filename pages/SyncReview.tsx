import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as firestore from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../App';
import { Link2, AlertTriangle, CheckCircle2, Activity, RefreshCw } from 'lucide-react';
import { PageHeader, EmptyState, LoadingState, Badge } from '../components/ui';
import Pager from '../components/Pager';
import { usePagedQuery } from '../utils/usePagedQuery';
import { isLeaderRole, isManagerRole } from '../utils/roles';
import { integrationHealth, linkSyncReview, BridgeUnavailable, IntegrationHealth } from '../bridgeService';

// "حجوزات محتاجة ربط": accounting bookings the sync could not attach to exactly one CRM client
// (no phone, or the phone matches several clients). A manager picks the right client; the server
// (linkSyncReview) applies the booking to it and remembers the choice, so later syncs of the same
// booking go straight to that client instead of reopening the review.

interface Review {
  id: string;
  bookingId: string;
  reason: 'no_phone' | 'ambiguous_phone' | string;
  candidates?: string[];
  customerName?: string;
  createdAt?: number;
  summary?: { courseName?: string; total?: number; paid?: number; status?: string; accountingSalesName?: string };
}

const REASONS: Record<string, string> = {
  no_phone: 'الحجز من غير رقم',
  ambiguous_phone: 'الرقم موجود عند أكتر من عميل',
};
const fmtDate = (ms?: number | null) => (ms ? new Date(ms).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const money = (n?: number) => (typeof n === 'number' ? n.toLocaleString('ar-EG') : '—');

const HealthCard: React.FC = () => {
  const [h, setH] = useState<IntegrationHealth | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'unavailable' | 'error'>('loading');
  const load = () => {
    setState('loading');
    integrationHealth().then((r) => { setH(r); setState('ok'); })
      .catch((e) => setState(e instanceof BridgeUnavailable ? 'unavailable' : 'error'));
  };
  useEffect(load, []);
  const cell = (label: string, value: React.ReactNode, bad?: boolean) => (
    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <p className={`text-lg font-black ${bad ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}>{value}</p>
    </div>
  );
  return (
    <section className="sgui-panel p-4 md:p-5 space-y-3" aria-label="صحة الربط">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-sm flex items-center gap-2"><Activity size={16} /> صحة الربط مع الحسابات والأتمتة</h2>
        <button onClick={load} className="sgui-icon-button" aria-label="تحديث"><RefreshCw size={14} /></button>
      </div>
      {state === 'loading' && <p className="text-xs text-slate-400 font-bold">جاري القراءة...</p>}
      {state === 'unavailable' && <p className="text-xs text-slate-500 font-bold">الكارت ده هيشتغل بعد تحديث السيرفر (نشر الدوال الجديدة).</p>}
      {state === 'error' && <p className="text-xs text-rose-600 font-bold">ماقدرناش نقرا الأرقام دلوقتي.</p>}
      {state === 'ok' && h && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {cell('حجوزات محتاجة ربط', h.openSyncReview ?? '—', (h.openSyncReview || 0) > 0)}
          {cell('أتمتة فشلت آخر 24 ساعة', h.failedAutomation24h ?? '—', (h.failedAutomation24h || 0) > 0)}
          {cell('آخر حجز وصل من الحسابات', fmtDate(h.lastIngestAt), !!h.lastIngestAt && Date.now() - h.lastIngestAt > 3 * 86400000)}
          {cell('آخر عميل من الأتمتة', fmtDate(h.lastAutomationAt), !!h.lastAutomationAt && Date.now() - h.lastAutomationAt > 2 * 86400000)}
        </div>
      )}
    </section>
  );
};

const CandidateName: React.FC<{ id: string }> = ({ id }) => {
  const [label, setLabel] = useState('...');
  useEffect(() => {
    firestore.getDoc(firestore.doc(db, 'clients', id))
      .then((d) => setLabel(d.exists() ? `${d.get('name') || 'بدون اسم'} · ${d.get('salesAgentName') || ''}` : 'العميل اتمسح'))
      .catch(() => setLabel(id));
  }, [id]);
  return <Link to={`/clients/${id}`} className="underline">{label}</Link>;
};

const SyncReview: React.FC = () => {
  const { user, effectiveRole } = useAuth();
  const isManager = isManagerRole(effectiveRole);
  const [busy, setBusy] = useState('');
  const [manualId, setManualId] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // Open reviews, 10 per page. Default (document id) order: no composite index needed.
  const paged = usePagedQuery<Review>({
    collectionName: 'sync_review',
    constraints: user && isManager ? [firestore.where('resolved', '==', false)] : null,
    queryKey: 'open',
    orderField: null,
    sessionCache: false,
  });

  const link = async (r: Review, clientId: string) => {
    const id = clientId.trim().replace(/^.*\/clients\//, '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!id) return;
    if (!confirm(`نربط حجز ${r.summary?.courseName || r.bookingId} بالعميل ده؟ فلوس الحجز هتتحسب عليه من الحسابات.`)) return;
    setBusy(r.id); setMsg(null);
    try {
      await linkSyncReview(r.bookingId || r.id, id);
      paged.patchRow(r.id, null);
      setMsg({ tone: 'ok', text: 'اتربط. المزامنة الجاية للحجز ده هتروح للعميل ده على طول.' });
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e instanceof BridgeUnavailable ? 'الربط من هنا هيشتغل بعد تحديث السيرفر (نشر الدوال الجديدة).' : (e?.message || 'ماقدرناش نربط.') });
    } finally { setBusy(''); }
  };

  if (!isLeaderRole(effectiveRole)) return <EmptyState icon={AlertTriangle}>الصفحة دي للمديرين بس.</EmptyState>;

  return (
    <div className="sg-page space-y-6 animate-fade-in">
      <PageHeader title="حجوزات محتاجة ربط" subtitle="حجوزات من الحسابات مش عارفين نربطها بعميل واحد. اختار العميل الصح." />
      <HealthCard />
      {!isManager ? (
        <EmptyState icon={AlertTriangle}>ربط الحجوزات للمديرين بس.</EmptyState>
      ) : (
        <section className="sgui-panel p-4 md:p-5 space-y-4">
          {msg && <p role="status" className={`p-3 rounded-xl text-xs font-bold ${msg.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>{msg.text}</p>}
          {paged.loading && paged.rows.length === 0 ? <LoadingState /> : paged.rows.length === 0 ? (
            <EmptyState icon={CheckCircle2}>مفيش حجوزات محتاجة ربط.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {paged.rows.map((r) => (
                <li key={r.id} className="p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-black text-sm">{r.customerName || 'عميل من غير اسم'} · {r.summary?.courseName || '—'}</p>
                      <p className="text-xs text-slate-500 font-bold">
                        الإجمالي {money(r.summary?.total)} · المدفوع {money(r.summary?.paid)} · السيلز في الحسابات: {r.summary?.accountingSalesName || '—'} · {fmtDate(r.createdAt)}
                      </p>
                    </div>
                    <Badge tone="warning">{REASONS[r.reason] || r.reason}</Badge>
                  </div>
                  {(r.candidates || []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-slate-500">العملاء اللي عليهم نفس الرقم:</p>
                      {(r.candidates || []).map((cid) => (
                        <div key={cid} className="flex items-center justify-between gap-2 text-xs font-bold">
                          <CandidateName id={cid} />
                          <button disabled={busy === r.id} onClick={() => link(r, cid)} className="sgui-button is-primary text-xs"><Link2 size={14} /> اربط بالعميل ده</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 items-center">
                    <label htmlFor={`manual-${r.id}`} className="text-xs font-bold text-slate-500">أو رابط / كود العميل:</label>
                    <input id={`manual-${r.id}`} dir="ltr" value={manualId[r.id] || ''} onChange={(e) => setManualId((p) => ({ ...p, [r.id]: e.target.value }))}
                      className="flex-1 min-w-[12rem] p-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs" placeholder="…/clients/abc123" />
                    <button disabled={busy === r.id || !(manualId[r.id] || '').trim()} onClick={() => link(r, manualId[r.id] || '')} className="sgui-button text-xs"><Link2 size={14} /> اربط</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Pager page={paged.page} pageCount={paged.pageCount} reachablePage={paged.reachablePage} total={paged.total} pageSize={paged.pageSize} loading={paged.loading} onPage={paged.goToPage} noun="حجز" />
        </section>
      )}
    </div>
  );
};

export default SyncReview;
