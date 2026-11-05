
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getCountFromServer, doc, updateDoc, QueryConstraint } from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { Client, UserRole } from '../types';
import { Calendar, CheckCircle, Clock, BookOpen, PhoneCall, CalendarPlus, AlertCircle, Clock4, Hash, UserCheck } from 'lucide-react';
import { PageHeader, SectionTitle, Badge, Tabs, LoadingState, EmptyState as SharedEmpty } from '../components/ui';
import FilterPanel, { Field } from '../components/FilterPanel';
import Pager from '../components/Pager';
import { usePagedQuery } from '../utils/usePagedQuery';
import { useServices, useAgentOptions } from '../utils/refData';
import FloatingPanel from '../components/FloatingPanel';
import AcceptFlowModal from '../components/AcceptFlowModal';
import { useNavigate } from 'react-router-dom';

type Tab = 'overdue' | 'today' | 'upcoming';

const DAY_MS = 86400000;
const endOfToday = () => new Date().setHours(23, 59, 59, 999);

// Follow-up tasks: one tab at a time, 10 per page, read page by page from the server
// (it used to keep a live listener on up to 300 clients and filter them in the browser).
const Notifications: React.FC = () => {
  const { user, effectiveRole, effectiveUser } = useAuth();
  const navigate = useNavigate();

  const [acceptFlowClient, setAcceptFlowClient] = useState<Client | null>(null);
  const services = useServices(true);
  const salesAgents = useAgentOptions([UserRole.SALES_AGENT, UserRole.TEAM_LEADER, UserRole.SUPERVISOR]);

  const [tab, setTab] = useState<Tab>('overdue');
  const [filterServiceId, setFilterServiceId] = useState<string>('all');
  const [filterAgentId, setFilterAgentId] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  const [loading, setLoading] = useState(false);
  const [rescheduleClient, setRescheduleClient] = useState<Client | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('10:00');
  const [newPeriod, setNewPeriod] = useState<'AM' | 'PM'>('AM');

  const isHighRole = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER || effectiveRole === UserRole.TEAM_LEADER;
  const scopeId = effectiveUser?.uid || user?.uid || '';

  // Who and which service (shared by the list and the tab counts).
  const scope = useMemo(() => {
    const c: QueryConstraint[] = [];
    if (!isHighRole) c.push(where('salesAgentId', '==', scopeId));
    else if (filterAgentId !== 'all') c.push(where('salesAgentId', '==', filterAgentId));
    if (filterServiceId !== 'all') c.push(where('serviceId', '==', filterServiceId));
    return c;
  }, [isHighRole, scopeId, filterAgentId, filterServiceId]);

  // The time window: a chosen day, or the tab.
  const rangeFor = (t: Tab | 'day'): QueryConstraint[] => {
    const now = Date.now();
    if (t === 'day') {
      const d = new Date(filterDate); d.setHours(0, 0, 0, 0);
      return [where('nextFollowUpDate', '>=', d.getTime()), where('nextFollowUpDate', '<=', d.getTime() + DAY_MS - 1)];
    }
    if (t === 'overdue') return [where('nextFollowUpDate', '>', 0), where('nextFollowUpDate', '<', now)];
    if (t === 'today') return [where('nextFollowUpDate', '>=', now), where('nextFollowUpDate', '<=', endOfToday())];
    return [where('nextFollowUpDate', '>', endOfToday())];
  };
  const activeRange: Tab | 'day' = filterDate ? 'day' : tab;

  const [counts, setCounts] = useState<Record<Tab, number | undefined>>({ overdue: undefined, today: undefined, upcoming: undefined });
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const ref = collection(db, 'clients');
    (['overdue', 'today', 'upcoming'] as Tab[]).forEach((t) => {
      getCountFromServer(query(ref, ...scope, ...rangeFor(t)))
        .then((r) => { if (!cancelled) setCounts((prev) => ({ ...prev, [t]: r.data().count })); })
        .catch((err) => console.error('Task count failed:', err));
    });
    return () => { cancelled = true; };
  }, [user?.uid, scope, refreshKey]);

  const paged = usePagedQuery<Client>({
    collectionName: 'clients',
    constraints: user ? [...scope, ...rangeFor(activeRange)] : null,
    queryKey: JSON.stringify([scopeId, isHighRole, filterAgentId, filterServiceId, activeRange, filterDate, refreshKey]),
    orderField: 'nextFollowUpDate',
    orderDirection: 'asc',
    withTotal: activeRange === 'day',
  });
  const total = activeRange === 'day' ? paged.total : counts[activeRange as Tab] ?? null;
  const pageCount = total === null || total === undefined ? paged.pageCount : Math.max(1, Math.ceil(total / paged.pageSize));

  const handleReschedule = async () => {
    if (!rescheduleClient || !newDate || !user) return;
    
    const [h, m] = newTime.split(':').map(Number);
    const finalH = newPeriod === 'PM' && h < 12 ? h + 12 : (newPeriod === 'AM' && h === 12 ? 0 : h);
    const dateObj = new Date(newDate);
    dateObj.setHours(finalH, m, 0, 0);
    const nextTs = dateObj.getTime();

    try {
      setLoading(true);
      await updateDoc(doc(db, 'clients', rescheduleClient.id), { nextFollowUpDate: nextTs });
      await logActivity(user.uid, user.name, "إعادة جدولة سريعة", rescheduleClient.id, rescheduleClient.name);
      setRescheduleClient(null);
      refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const activeFilters = [filterServiceId, filterAgentId].filter(v => v !== 'all').length + (filterDate ? 1 : 0);

  return (
    <div className="sg-page animate-fade-in">
      <PageHeader title="المهام والمتابعات" subtitle="مواعيد المتابعة: المتأخر الأول، وبعده النهارده، وبعده الجاي" />

      <FilterPanel
        activeCount={activeFilters}
        advancedCount={filterDate ? 1 : 0}
        onReset={() => { setFilterDate(''); setFilterServiceId('all'); setFilterAgentId('all'); }}
        main={<>
          {isHighRole && (
            <Field label="السيلز">
              <select value={filterAgentId} onChange={e => setFilterAgentId(e.target.value)}>
                <option value="all">كل الموظفين</option>
                {salesAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="الخدمة">
            <select value={filterServiceId} onChange={e => setFilterServiceId(e.target.value)}>
              <option value="all">كل الخدمات</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </>}
        advanced={
          <Field label="مواعيد يوم معيّن">
            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
          </Field>
        }
      />

      <section className="sgui-panel p-4 md:p-5">
        {filterDate ? (
          <SectionTitle icon={<Calendar size={18} />} title={`مواعيد يوم ${new Date(filterDate).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}`} count={paged.total ?? undefined}
            action={<button type="button" onClick={() => setFilterDate('')}>رجوع للتبويبات</button>} />
        ) : (
          <Tabs label="المتابعات" value={tab} onChange={setTab} items={[
            { value: 'overdue', label: 'متأخرة', count: counts.overdue, icon: AlertCircle, danger: (counts.overdue || 0) > 0 },
            { value: 'today', label: 'باقي النهارده', count: counts.today, icon: Clock },
            { value: 'upcoming', label: 'الجاية', count: counts.upcoming, icon: Calendar },
          ]} />
        )}

        {paged.loading && paged.rows.length === 0 ? (
          <LoadingState />
        ) : paged.rows.length === 0 ? (
          <EmptyState message={activeRange === 'overdue' ? 'مفيش متابعات متأخرة' : 'مفيش مواعيد هنا'} icon={activeRange === 'overdue' ? CheckCircle : Calendar} />
        ) : (
          <div className="sgui-list">
            {paged.rows.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onContact={() => navigate(`/clients/${task.id}`)}
                onReschedule={() => { setRescheduleClient(task); setNewDate(new Date(task.nextFollowUpDate!).toISOString().split('T')[0]); }}
                onAccept={() => setAcceptFlowClient(task)}
              />
            ))}
          </div>
        )}
        <Pager page={paged.page} pageCount={pageCount} reachablePage={paged.reachablePage} total={total ?? null} pageSize={paged.pageSize} loading={paged.loading} onPage={paged.goToPage} noun="متابعة" />
      </section>

      <FloatingPanel 
        isOpen={!!rescheduleClient} 
        onClose={() => setRescheduleClient(null)} 
        title="إعادة جدولة سريعة"
        icon={<CalendarPlus size={24} className="text-amber-500" />}
      >
             <div className="space-y-4 pt-2">
               <div className="space-y-1">
                 <label className="text-[10px] font-black uppercase text-slate-400">التاريخ الجديد</label>
                 <input type="date" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none text-slate-900 dark:text-white border border-transparent focus:border-primary-500" value={newDate} onChange={e => setNewDate(e.target.value)} />
               </div>
               <div className="flex gap-3">
                 <div className="flex-1 space-y-1">
                   <label className="text-[10px] font-black uppercase text-slate-400">الوقت</label>
                   <input type="time" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none text-slate-900 dark:text-white border border-transparent focus:border-primary-500" value={newTime} onChange={e => setNewTime(e.target.value)} />
                 </div>
                 <div className="w-32 space-y-1">
                   <label className="text-[10px] font-black uppercase text-slate-400">الفترة</label>
                   <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none text-slate-900 dark:text-white border border-transparent focus:border-primary-500" value={newPeriod} onChange={e => setNewPeriod(e.target.value as any)}>
                     <option value="AM">AM</option><option value="PM">PM</option>
                   </select>
                 </div>
               </div>
               <button onClick={handleReschedule} disabled={loading} className="sgui-button is-primary w-full">تحديث الموعد</button>
             </div>
      </FloatingPanel>

      {acceptFlowClient && (
        <AcceptFlowModal
          key={acceptFlowClient.id}
          client={acceptFlowClient}
          onClose={() => setAcceptFlowClient(null)}
          onDone={() => setAcceptFlowClient(null)}
        />
      )}
    </div>
  );
};

const TaskCard: React.FC<{
  task: Client;
  onContact: () => void;
  onReschedule: () => void;
  onAccept: () => void;
}> = ({ task, onContact, onReschedule, onAccept }) => {
  const now = Date.now();
  const taskTime = task.nextFollowUpDate || 0;
  const isOverdue = taskTime < now;
  const isToday = new Date(taskTime).toDateString() === new Date().toDateString();

  const d = new Date(taskTime);
  const dateStr = d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });

  const isUnreviewedAi = task.nextFollowUpSetVia === 'ai_automation' && !task.nextFollowUpReviewedBySales;
  const time = d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className={`sgui-followup ${isUnreviewedAi ? 'is-suggested' : isOverdue ? 'is-overdue' : isToday ? 'is-today' : ''}`}>
      <div className="sgui-followup-time">
        <Badge tone={isOverdue ? 'danger' : isToday ? 'warning' : 'neutral'}>{isOverdue ? 'فات الموعد' : isToday ? 'النهارده' : 'موعد جاي'}</Badge>
        <b>{time}</b>
        <small>{dateStr}</small>
      </div>
      <div className="sgui-followup-main">
        <h3>{task.name}</h3>
        {isUnreviewedAi ? (
          <button type="button" onClick={onAccept} className="sgui-state is-warning mt-1"><Clock4 size={12} /> AI Generated — Accept</button>
        ) : task.nextFollowUpSetVia === 'ai_automation' && task.nextFollowUpReviewedByName && (
          <span className="sgui-state mt-1"><Clock4 size={12} /> AI Generated & Accepted by {task.nextFollowUpReviewedByName}</span>
        )}
        <dl>
          <div><dt><BookOpen size={13} /> الخدمة</dt><dd>{task.serviceName}</dd></div>
          <div><dt><UserCheck size={13} /> السيلز</dt><dd>{task.salesAgentName}</dd></div>
          <div><dt><Hash size={13} /> الهاتف</dt><dd dir="ltr">{task.phone}</dd></div>
        </dl>
      </div>
      <div className="sgui-followup-actions">
        <button type="button" onClick={onReschedule} className="sgui-button"><CalendarPlus size={17} /> إعادة جدولة</button>
        <button type="button" onClick={onContact} className="sgui-button is-primary"><PhoneCall size={17} /> تواصل الآن</button>
      </div>
    </div>
  );
};

const EmptyState = ({ message, icon: Icon }: any) => <SharedEmpty icon={Icon}>{message}</SharedEmpty>;

export default Notifications;
