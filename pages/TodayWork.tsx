import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as firestore from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../App';
import { Client, UserRole } from '../types';
import { AlertTriangle, CalendarClock, CalendarX2, MessageCircle, PhoneCall, CheckCircle2 } from 'lucide-react';
import { PageHeader, Tabs, EmptyState, LoadingState } from '../components/ui';
import Pager from '../components/Pager';
import { usePagedQuery } from '../utils/usePagedQuery';

const DAY = 86400000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const waLink = (phone: string) => `https://wa.me/${String(phone || '').replace(/\D/g, '').replace(/^0+/, phone.startsWith('0') ? '20' : '')}`;
const fmt = (ms?: number) => (ms ? new Date(ms).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) : '—');

type Group = 'overdue' | 'today' | 'noDate';
const OPEN = ['interested', 'potential'];

// "Today's work": open leads that need action, one tab at a time, 10 per page, read from the
// server (it used to read every open client of the team on each visit: ~2,600 documents).
// The point is to make sure no open lead is left without a next follow-up date.
const TodayWork: React.FC = () => {
  const { user, effectiveUser, effectiveRole } = useAuth();
  const [busyId, setBusyId] = useState('');
  const isLeader = effectiveRole !== UserRole.SALES_AGENT;
  const [mine, setMine] = useState(!isLeader);
  const [group, setGroup] = useState<Group>('overdue');
  const ownerId = effectiveUser?.uid || user?.uid || '';

  const scope = useMemo(() => {
    const c: firestore.QueryConstraint[] = [firestore.where('status', 'in', OPEN)];
    if (mine || !isLeader) c.push(firestore.where('salesAgentId', '==', ownerId));
    return c;
  }, [mine, isLeader, ownerId]);

  const t0 = startOfToday();
  const rangeFor = (g: Group): firestore.QueryConstraint[] => (
    g === 'overdue' ? [firestore.where('nextFollowUpDate', '>', 0), firestore.where('nextFollowUpDate', '<', t0)]
      : g === 'today' ? [firestore.where('nextFollowUpDate', '>=', t0), firestore.where('nextFollowUpDate', '<', t0 + DAY)]
        : [firestore.where('nextFollowUpDate', '==', 0)]
  );

  const [counts, setCounts] = useState<Record<Group, number | undefined>>({ overdue: undefined, today: undefined, noDate: undefined });
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (['overdue', 'today', 'noDate'] as Group[]).forEach((g) => {
      firestore.getCountFromServer(firestore.query(firestore.collection(db, 'clients'), ...scope, ...rangeFor(g)))
        .then((r) => { if (!cancelled) setCounts((prev) => ({ ...prev, [g]: r.data().count })); })
        .catch((err) => console.error('Today count failed:', err));
    });
    return () => { cancelled = true; };
  }, [user?.uid, scope, t0]);

  // Open leads that have no nextFollowUpDate field at all can't be found by a query; an admin
  // can give them the value 0 once (one read per open client, then they show up here).
  const isAdmin = user?.role === UserRole.ADMIN;
  const [unprepared, setUnprepared] = useState(0);
  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    if (!isAdmin || mine) return;
    let cancelled = false;
    const ref = firestore.collection(db, 'clients');
    const n = (q: firestore.Query) => firestore.getCountFromServer(q).then((r) => r.data().count);
    Promise.all([
      n(firestore.query(ref, firestore.where('status', 'in', OPEN))),
      n(firestore.query(ref, firestore.where('status', 'in', OPEN), firestore.where('nextFollowUpDate', '>=', 0))),
    ]).then(([all, withField]) => { if (!cancelled) setUnprepared(Math.max(0, all - withField)); })
      .catch((err) => console.error('Unprepared count failed:', err));
    return () => { cancelled = true; };
  }, [isAdmin, mine]);
  const prepareOldClients = async () => {
    if (!confirm(`هيتكتب "من غير موعد" على ${unprepared} عميل مفتوح ملهمش خانة موعد، عشان يظهروا هنا. نكمّل؟`)) return;
    setPreparing(true);
    try {
      const snap = await firestore.getDocs(firestore.query(firestore.collection(db, 'clients'), firestore.where('status', 'in', OPEN)));
      const todo = snap.docs.filter((d) => typeof d.get('nextFollowUpDate') !== 'number');
      for (let i = 0; i < todo.length; i += 400) {
        const batch = firestore.writeBatch(db);
        todo.slice(i, i + 400).forEach((d) => batch.update(d.ref, { nextFollowUpDate: 0 }));
        await batch.commit();
      }
      setUnprepared(0);
      setCounts((prev) => ({ ...prev, noDate: (prev.noDate || 0) + todo.length }));
      paged.reload();
    } catch (e) { console.error(e); alert('حصل خطأ أثناء التجهيز.'); }
    finally { setPreparing(false); }
  };

  const paged = usePagedQuery<Client>({
    collectionName: 'clients',
    constraints: user ? [...scope, ...rangeFor(group)] : null,
    queryKey: JSON.stringify([ownerId, mine, isLeader, group, t0]),
    orderField: group === 'noDate' ? 'createdAt' : 'nextFollowUpDate',
    orderDirection: group === 'noDate' ? 'desc' : 'asc',
    withTotal: false,
  });
  const total = counts[group] ?? null;

  const setNext = async (c: Client, days: number) => {
    setBusyId(c.id);
    try {
      const when = new Date(); when.setDate(when.getDate() + days); when.setHours(12, 0, 0, 0);
      await firestore.updateDoc(firestore.doc(db, 'clients', c.id), { nextFollowUpDate: when.getTime(), nextFollowUpSetVia: 'manual' });
      // It leaves the "no date" list.
      paged.patchRow(c.id, null);
      setCounts((prev) => ({ ...prev, noDate: Math.max(0, (prev.noDate || 1) - 1) }));
    } catch (e) { console.error(e); alert('تعذر تحديد الموعد.'); }
    finally { setBusyId(''); }
  };

  return (
    <div className="sg-page space-y-6 animate-fade-in">
      <PageHeader
        title="شغل النهارده"
        subtitle="المتأخر، وموعد النهارده، وعملاء مهتمين من غير موعد متابعة."
        actions={isLeader && (
          <>
            <button onClick={() => setMine(true)} aria-pressed={mine} className={`sgui-button ${mine ? 'is-primary' : ''}`}>عملائي</button>
            <button onClick={() => setMine(false)} aria-pressed={!mine} className={`sgui-button ${!mine ? 'is-primary' : ''}`}>كل الفريق</button>
          </>
        )}
      />
      <section className="sgui-panel p-4 md:p-5">
        <Tabs label="شغل النهارده" value={group} onChange={setGroup} items={[
          { value: 'overdue', label: 'متأخرة', count: counts.overdue, icon: AlertTriangle, danger: (counts.overdue || 0) > 0 },
          { value: 'today', label: 'النهارده', count: counts.today, icon: CalendarClock },
          { value: 'noDate', label: 'من غير موعد (حدّد موعد)', count: counts.noDate, icon: CalendarX2 },
        ]} />
        {group === 'noDate' && unprepared > 0 && (
          <div className="sgui-notice">
            <span>فيه {unprepared.toLocaleString('ar-EG')} عميل مفتوح مش ظاهرين هنا لأن مفيش عندهم خانة موعد خالص (عملاء قدام).</span>
            <button type="button" className="sgui-button" disabled={preparing} onClick={prepareOldClients}>{preparing ? 'جاري التجهيز...' : 'تجهيزهم (مرة واحدة)'}</button>
          </div>
        )}
        {paged.loading && paged.rows.length === 0 ? <LoadingState /> : paged.rows.length === 0 ? (
          <EmptyState icon={CheckCircle2}>مفيش حاجة هنا.</EmptyState>
        ) : (
          <div className="sgui-list">
            {paged.rows.map((c) => (
              <div key={c.id} className={`sgui-row is-static ${group === 'overdue' ? 'is-overdue' : ''}`}>
                <div className="sgui-row-main">
                  <Link to={`/clients/${c.id}`} className="sgui-row-title">{c.name}</Link>
                  <small>
                    {c.serviceName || '—'} · آخر متابعة {fmt(c.lastFollowUpDate)}{c.nextFollowUpDate ? ` · الموعد ${fmt(c.nextFollowUpDate)}` : ''}{isLeader && !mine ? ` · ${c.salesAgentName}` : ''}
                  </small>
                </div>
                {group === 'noDate' && (
                  <div className="flex gap-1.5 flex-wrap">
                    {[[1, 'بكرة'], [2, 'بعد يومين'], [7, 'أسبوع']].map(([d, label]) => (
                      <button key={String(d)} disabled={busyId === c.id} onClick={() => setNext(c, Number(d))} className="sgui-button">{label}</button>
                    ))}
                  </div>
                )}
                {c.phone && (
                  <div className="flex gap-2">
                    <a href={`tel:${c.phone}`} className="sgui-icon-button" aria-label="اتصال"><PhoneCall size={16} /></a>
                    <a href={waLink(c.phone)} target="_blank" rel="noreferrer" className="sgui-icon-button is-whatsapp" aria-label="واتساب"><MessageCircle size={16} /></a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <Pager page={paged.page} pageCount={total === null ? paged.pageCount : Math.max(1, Math.ceil(total / paged.pageSize))} reachablePage={paged.reachablePage} total={total} pageSize={paged.pageSize} loading={paged.loading} onPage={paged.goToPage} noun="عميل" />
      </section>
    </div>
  );
};

export default TodayWork;
