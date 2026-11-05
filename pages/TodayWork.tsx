import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as firestore from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../App';
import { Client, UserRole } from '../types';
import { AlertTriangle, CalendarClock, CalendarX2, MessageCircle, PhoneCall, CheckCircle2 } from 'lucide-react';

const DAY = 86400000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const waLink = (phone: string) => `https://wa.me/${String(phone || '').replace(/\D/g, '').replace(/^0+/, phone.startsWith('0') ? '20' : '')}`;
const fmt = (ms?: number) => (ms ? new Date(ms).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) : '—');

// "Today's work": one list instead of hunting across tabs. The point is to make sure no open
// lead is left without a next follow-up date (92% were).
const TodayWork: React.FC = () => {
  const { user, effectiveRole } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const isLeader = effectiveRole !== UserRole.SALES_AGENT;
  const [mine, setMine] = useState(!isLeader);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const base = firestore.collection(db, 'clients');
    const q = mine || !isLeader
      ? firestore.query(base, firestore.where('salesAgentId', '==', user.uid), firestore.where('status', 'in', ['interested', 'potential']))
      : firestore.query(base, firestore.where('status', 'in', ['interested', 'potential']));
    const snap = await firestore.getDocs(q);
    setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Client)));
    setLoading(false);
  };
  useEffect(() => { load().catch((e) => { console.error(e); setLoading(false); }); }, [user?.uid, mine]);

  const t0 = startOfToday();
  const groups = useMemo(() => {
    const overdue = clients.filter((c) => c.nextFollowUpDate && c.nextFollowUpDate < t0).sort((a, b) => (a.nextFollowUpDate || 0) - (b.nextFollowUpDate || 0));
    const today = clients.filter((c) => c.nextFollowUpDate && c.nextFollowUpDate >= t0 && c.nextFollowUpDate < t0 + DAY);
    const noDate = clients.filter((c) => !c.nextFollowUpDate).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return { overdue, today, noDate };
  }, [clients, t0]);

  const setNext = async (c: Client, days: number) => {
    setBusyId(c.id);
    try {
      const when = new Date(); when.setDate(when.getDate() + days); when.setHours(12, 0, 0, 0);
      await firestore.updateDoc(firestore.doc(db, 'clients', c.id), { nextFollowUpDate: when.getTime(), nextFollowUpSetVia: 'manual' });
      setClients((all) => all.map((x) => (x.id === c.id ? { ...x, nextFollowUpDate: when.getTime() } : x)));
    } catch (e) { console.error(e); alert('تعذر تحديد الموعد.'); }
    finally { setBusyId(''); }
  };

  const Row: React.FC<{ c: Client; quick?: boolean }> = ({ c, quick }) => (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[180px]">
        <Link to={`/clients/${c.id}`} className="font-black text-slate-900 dark:text-white hover:text-primary-600">{c.name}</Link>
        <div className="text-[11px] text-slate-500 font-bold mt-0.5">
          {c.serviceName || '—'} · آخر متابعة {fmt(c.lastFollowUpDate)}{c.nextFollowUpDate ? ` · الموعد ${fmt(c.nextFollowUpDate)}` : ''}{isLeader && !mine ? ` · ${c.salesAgentName}` : ''}
        </div>
      </div>
      {c.phone && (
        <div className="flex gap-2">
          <a href={`tel:${c.phone}`} className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800" aria-label="اتصال"><PhoneCall size={16} /></a>
          <a href={waLink(c.phone)} target="_blank" rel="noreferrer" className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600" aria-label="واتساب"><MessageCircle size={16} /></a>
        </div>
      )}
      {quick && (
        <div className="flex gap-1.5">
          {[[1, 'بكرة'], [2, 'بعد يومين'], [7, 'أسبوع']].map(([d, label]) => (
            <button key={String(d)} disabled={busyId === c.id} onClick={() => setNext(c, Number(d))} className="px-3 py-2 rounded-xl text-[11px] font-black bg-primary-50 text-primary-700 hover:bg-primary-100 disabled:opacity-50">{label}</button>
          ))}
        </div>
      )}
    </div>
  );

  const Section: React.FC<{ title: string; icon: React.ReactNode; list: Client[]; quick?: boolean; tone: string; cap?: number }> = ({ title, icon, list, quick, tone, cap = 60 }) => (
    <section className="space-y-3">
      <h2 className={`font-black text-lg flex items-center gap-2 ${tone}`}>{icon} {title} <span className="text-slate-400 text-sm">({list.length})</span></h2>
      {list.length === 0 ? <p className="text-slate-500 font-bold text-sm flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-500" /> مفيش حاجة هنا.</p>
        : list.slice(0, cap).map((c) => <Row key={c.id} c={c} quick={quick} />)}
      {list.length > cap && <p className="text-xs text-slate-400 font-bold">وفي {list.length - cap} كمان. كمّل اللي فوق الأول.</p>}
    </section>
  );

  return (
    <div className="sg-page space-y-6 animate-fade-in">
      <header className="sgui-heading">
        <div>
          <h1>شغل النهارده</h1>
          <p>المتأخر، وموعد النهارده، وعملاء مهتمين من غير موعد متابعة.</p>
        </div>
        {isLeader && (
          <div className="flex gap-2 text-xs font-black">
            <button onClick={() => setMine(true)} aria-pressed={mine} className={`sgui-button ${mine ? 'is-primary' : ''}`}>عملائي</button>
            <button onClick={() => setMine(false)} aria-pressed={!mine} className={`sgui-button ${!mine ? 'is-primary' : ''}`}>كل الفريق</button>
          </div>
        )}
      </header>
      {loading ? <p className="text-slate-500 font-bold">جاري التحميل…</p> : (
        <>
          <Section title="متأخرة" icon={<AlertTriangle size={20} />} list={groups.overdue} tone="text-rose-600" />
          <Section title="النهارده" icon={<CalendarClock size={20} />} list={groups.today} tone="text-primary-600" />
          <Section title="مهتمين من غير موعد متابعة (حدّد موعد)" icon={<CalendarX2 size={20} />} list={groups.noDate} quick tone="text-amber-600" />
        </>
      )}
    </div>
  );
};

export default TodayWork;
