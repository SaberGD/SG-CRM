
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getCountFromServer, doc, updateDoc, deleteField, QueryConstraint } from 'firebase/firestore';
import { AUTO_KIND, checkInDate, planCheckInReschedule } from '../utils/autoFollowUp';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { Client, UserRole, FollowUp, CommMethodLabels } from '../types';
import { Calendar, CheckCircle, Clock, BookOpen, PhoneCall, CalendarPlus, AlertCircle, Clock4, Hash, UserCheck, HeartHandshake, CheckCircle2, MessageCircle } from 'lucide-react';
import { PageHeader, SectionTitle, Badge, Tabs, LoadingState, EmptyState as SharedEmpty } from '../components/ui';
import FilterPanel, { Field } from '../components/FilterPanel';
import Pager from '../components/Pager';
import { usePagedQuery } from '../utils/usePagedQuery';
import { useServices, useAgentOptions } from '../utils/refData';
import FloatingPanel from '../components/FloatingPanel';
import AcceptFlowModal from '../components/AcceptFlowModal';
import { useNavigate, Link } from 'react-router-dom';

type Tab = 'overdue' | 'today' | 'upcoming' | 'checkin';
type CheckInView = 'pending' | 'done';

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
  // Inside the check-in tab: still to do (clients with nextCheckInDate) or the log of done ones (followups kind).
  const [checkInView, setCheckInView] = useState<CheckInView>('pending');
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
  const rangeFor = (t: Exclude<Tab, 'checkin'> | 'day'): QueryConstraint[] => {
    const now = Date.now();
    if (t === 'day') {
      const d = new Date(filterDate); d.setHours(0, 0, 0, 0);
      return [where('nextFollowUpDate', '>=', d.getTime()), where('nextFollowUpDate', '<=', d.getTime() + DAY_MS - 1)];
    }
    if (t === 'overdue') return [where('nextFollowUpDate', '>', 0), where('nextFollowUpDate', '<', now)];
    if (t === 'today') return [where('nextFollowUpDate', '>=', now), where('nextFollowUpDate', '<=', endOfToday())];
    return [where('nextFollowUpDate', '>', endOfToday())];
  };
  // The date filter does not apply to the check-in tab (check-ins are day-level and have their own list).
  const isCheckInTab = tab === 'checkin';
  const dayMode = !!filterDate && !isCheckInTab;
  const activeRange: Exclude<Tab, 'checkin'> | 'day' | 'checkin' = isCheckInTab ? 'checkin' : dayMode ? 'day' : tab as Exclude<Tab, 'checkin'>;

  const [counts, setCounts] = useState<Record<Tab, number | undefined>>({ overdue: undefined, today: undefined, upcoming: undefined, checkin: undefined });
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const ref = collection(db, 'clients');
    (['overdue', 'today', 'upcoming'] as const).forEach((t) => {
      getCountFromServer(query(ref, ...scope, ...rangeFor(t)))
        .then((r) => { if (!cancelled) setCounts((prev) => ({ ...prev, [t]: r.data().count })); })
        .catch((err) => console.error('Task count failed:', err));
    });
    // Pending personal check-ins (their own field, so they never mix with the tabs above).
    getCountFromServer(query(ref, ...scope, where('nextCheckInDate', '>', 0)))
      .then((r) => { if (!cancelled) setCounts((prev) => ({ ...prev, checkin: r.data().count })); })
      .catch((err) => console.error('Check-in count failed:', err));
    return () => { cancelled = true; };
  }, [user?.uid, scope, refreshKey]);

  const paged = usePagedQuery<Client>({
    collectionName: 'clients',
    constraints: user && !isCheckInTab ? [...scope, ...rangeFor(activeRange as Exclude<Tab, 'checkin'> | 'day')] : null,
    queryKey: JSON.stringify([scopeId, isHighRole, filterAgentId, filterServiceId, activeRange, filterDate, refreshKey]),
    orderField: 'nextFollowUpDate',
    orderDirection: 'asc',
    withTotal: activeRange === 'day',
  });
  const total = activeRange === 'day' ? paged.total : counts[activeRange as Tab] ?? null;
  const pageCount = total === null || total === undefined ? paged.pageCount : Math.max(1, Math.ceil(total / paged.pageSize));

  // Check-in tab, "المطلوبة": clients with a pending check-in, oldest first (same filters as the other tabs).
  const checkInPending = usePagedQuery<Client>({
    collectionName: 'clients',
    constraints: user && isCheckInTab && checkInView === 'pending' ? [...scope, where('nextCheckInDate', '>', 0)] : null,
    queryKey: JSON.stringify(['checkin', scopeId, isHighRole, filterAgentId, filterServiceId, refreshKey]),
    orderField: 'nextCheckInDate',
    orderDirection: 'asc',
    withTotal: false, // the tab count is the total
  });
  const checkInPendingTotal = counts.checkin ?? null;
  const checkInPendingPages = checkInPendingTotal === null ? checkInPending.pageCount : Math.max(1, Math.ceil(checkInPendingTotal / checkInPending.pageSize));

  // Check-in tab, "اتعملت": the log of done check-ins (followups of kind auto_booked), newest first.
  // Follow-ups carry the agent but not the service, so the service filter does not apply here.
  const doneScope = useMemo(() => {
    const c: QueryConstraint[] = [];
    if (!isHighRole) c.push(where('agentId', '==', scopeId));
    else if (filterAgentId !== 'all') c.push(where('agentId', '==', filterAgentId));
    c.push(where('kind', '==', AUTO_KIND));
    return c;
  }, [isHighRole, scopeId, filterAgentId]);
  const checkInDone = usePagedQuery<FollowUp>({
    collectionName: 'followups',
    constraints: user && isCheckInTab && checkInView === 'done' ? doneScope : null,
    queryKey: JSON.stringify(['checkin-done', scopeId, isHighRole, filterAgentId, refreshKey]),
    orderField: 'timestamp',
    orderDirection: 'desc',
    withTotal: true,
  });

  const handleReschedule = async () => {
    if (!rescheduleClient || !newDate || !user) return;
    
    const [h, m] = newTime.split(':').map(Number);
    const finalH = newPeriod === 'PM' && h < 12 ? h + 12 : (newPeriod === 'AM' && h === 12 ? 0 : h);
    const dateObj = new Date(newDate);
    dateObj.setHours(finalH, m, 0, 0);
    const nextTs = dateObj.getTime();

    try {
      setLoading(true);
      if (isCheckInTab) {
        // The check-in has its own date; the normal follow-up date is not touched.
        await updateDoc(doc(db, 'clients', rescheduleClient.id), planCheckInReschedule(rescheduleClient, nextTs, deleteField()));
        await logActivity(user.uid, user.name, "إعادة جدولة الاطمئنان (متابعة شخصية)", rescheduleClient.id, rescheduleClient.name);
      } else {
        await updateDoc(doc(db, 'clients', rescheduleClient.id), { nextFollowUpDate: nextTs });
        await logActivity(user.uid, user.name, "إعادة جدولة سريعة", rescheduleClient.id, rescheduleClient.name);
      }
      setRescheduleClient(null);
      refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const activeFilters = [filterServiceId, filterAgentId].filter(v => v !== 'all').length + (dayMode ? 1 : 0);

  return (
    <div className="sg-page animate-fade-in">
      <PageHeader title="المهام والمتابعات" subtitle="مواعيد المتابعة: المتأخر الأول، وبعده النهارده، وبعده الجاي. والاطمئنان على العملاء الحاجزين في تبويب لوحده" />

      <FilterPanel
        activeCount={activeFilters}
        advancedCount={dayMode ? 1 : 0}
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
            <select value={filterServiceId} onChange={e => setFilterServiceId(e.target.value)} disabled={isCheckInTab && checkInView === 'done'} title={isCheckInTab && checkInView === 'done' ? 'سجل الاطمئنان متسجل بالسيلز مش بالخدمة' : undefined}>
              <option value="all">كل الخدمات</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </>}
        advanced={isCheckInTab ? undefined : (
          <Field label="مواعيد يوم معيّن">
            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
          </Field>
        )}
      />

      <section className="sgui-panel p-4 md:p-5">
        {dayMode ? (
          <SectionTitle icon={<Calendar size={18} />} title={`مواعيد يوم ${new Date(filterDate).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}`} count={paged.total ?? undefined}
            action={<button type="button" onClick={() => setFilterDate('')}>رجوع للتبويبات</button>} />
        ) : (
          <Tabs label="المتابعات" value={tab} onChange={setTab} items={[
            { value: 'overdue', label: 'متأخرة', count: counts.overdue, icon: AlertCircle, danger: (counts.overdue || 0) > 0 },
            { value: 'today', label: 'باقي النهارده', count: counts.today, icon: Clock },
            { value: 'upcoming', label: 'الجاية', count: counts.upcoming, icon: Calendar },
            { value: 'checkin', label: 'اطمئنان', count: counts.checkin, icon: HeartHandshake, checkin: true },
          ]} />
        )}

        {isCheckInTab && (
          <div className="sgui-segment" role="tablist" aria-label="الاطمئنان">
            <button type="button" role="tab" aria-selected={checkInView === 'pending'} className={checkInView === 'pending' ? 'is-active' : ''} onClick={() => setCheckInView('pending')}>المطلوبة{counts.checkin !== undefined ? ` (${counts.checkin})` : ''}</button>
            <button type="button" role="tab" aria-selected={checkInView === 'done'} className={checkInView === 'done' ? 'is-active' : ''} onClick={() => setCheckInView('done')}>اتعملت</button>
          </div>
        )}

        {isCheckInTab && checkInView === 'pending' ? (
          <>
            {checkInPending.loading && checkInPending.rows.length === 0 ? (
              <LoadingState />
            ) : checkInPending.rows.length === 0 ? (
              <EmptyState message="مفيش اطمئنان مطلوب دلوقتي" icon={HeartHandshake} />
            ) : (
              <div className="sgui-list">
                {checkInPending.rows.map(task => (
                  <CheckInCard
                    key={task.id}
                    task={task}
                    onDone={() => navigate(`/clients/${task.id}?checkin=1`)}
                    onReschedule={() => { setRescheduleClient(task); const d = checkInDate(task); setNewDate(new Date(d || Date.now()).toISOString().split('T')[0]); }}
                  />
                ))}
              </div>
            )}
            <Pager page={checkInPending.page} pageCount={checkInPendingPages} reachablePage={checkInPending.reachablePage} total={checkInPendingTotal} pageSize={checkInPending.pageSize} loading={checkInPending.loading} onPage={checkInPending.goToPage} noun="اطمئنان" />
          </>
        ) : isCheckInTab ? (
          <>
            {checkInDone.loading && checkInDone.rows.length === 0 ? (
              <LoadingState />
            ) : checkInDone.rows.length === 0 ? (
              <EmptyState message="لسه مفيش اطمئنان اتعمل" icon={CheckCircle2} />
            ) : (
              <div className="sgui-list">
                {checkInDone.rows.map(f => <CheckInDoneRow key={f.id} f={f} />)}
              </div>
            )}
            <Pager page={checkInDone.page} pageCount={checkInDone.pageCount} reachablePage={checkInDone.reachablePage} total={checkInDone.total} pageSize={checkInDone.pageSize} loading={checkInDone.loading} onPage={checkInDone.goToPage} noun="اطمئنان" />
          </>
        ) : paged.loading && paged.rows.length === 0 ? (
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
        {!isCheckInTab && <Pager page={paged.page} pageCount={pageCount} reachablePage={paged.reachablePage} total={total ?? null} pageSize={paged.pageSize} loading={paged.loading} onPage={paged.goToPage} noun="متابعة" />}
      </section>

      <FloatingPanel 
        isOpen={!!rescheduleClient} 
        onClose={() => setRescheduleClient(null)} 
        title={isCheckInTab ? 'إعادة جدولة الاطمئنان' : 'إعادة جدولة سريعة'}
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
        ) : task.nextFollowUpSetVia === 'ai_automation' && task.nextFollowUpReviewedByName ? (
          <span className="sgui-state mt-1"><Clock4 size={12} /> AI Generated & Accepted by {task.nextFollowUpReviewedByName}</span>
        ) : null}
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

// A pending personal check-in (اطمئنان): violet, day-level (no time of day).
const CheckInCard: React.FC<{ task: Client; onDone: () => void; onReschedule: () => void }> = ({ task, onDone, onReschedule }) => {
  const when = checkInDate(task);
  const d = new Date(when);
  const endToday = new Date().setHours(23, 59, 59, 999);
  const startToday = new Date().setHours(0, 0, 0, 0);
  const state = when < startToday ? 'فات موعده' : when <= endToday ? 'النهارده' : 'جاي';
  return (
    <div className="sgui-followup is-checkin">
      <div className="sgui-followup-time">
        <span className="sgui-state is-checkin"><HeartHandshake size={13} /> اطمئنان · {state}</span>
        <b>{d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })}</b>
        <small>{d.toLocaleDateString('ar-EG', { weekday: 'long' })}</small>
      </div>
      <div className="sgui-followup-main">
        <h3><Link to={`/clients/${task.id}`}>{task.name}</Link></h3>
        <p className="sgui-checkin-hint">
          لو الكورس لسه مابدأش: حمّسه وقوله "بنتطمن عليك بشكل شخصي، بدأت تستعد للكورس؟" · لو بدأ: "الكورس ماشي تمام؟ محتاج أي مساعدة؟"
        </p>
        <dl>
          <div><dt><BookOpen size={13} /> الخدمة</dt><dd>{task.bookedCourseName || task.serviceName}</dd></div>
          <div><dt><UserCheck size={13} /> السيلز</dt><dd>{task.salesAgentName}</dd></div>
          <div><dt><Hash size={13} /> الهاتف</dt><dd dir="ltr">{task.phone}</dd></div>
        </dl>
      </div>
      <div className="sgui-followup-actions">
        <button type="button" onClick={onReschedule} className="sgui-button"><CalendarPlus size={17} /> إعادة جدولة</button>
        <button type="button" onClick={onDone} className="sgui-button is-primary"><CheckCircle2 size={17} /> تمت المتابعة</button>
      </div>
    </div>
  );
};

// A done check-in from the log: same violet family, muted, with a check.
const CheckInDoneRow: React.FC<{ f: FollowUp }> = ({ f }) => {
  const d = new Date(f.timestamp);
  const excerpt = (t?: string) => (t && t.length > 140 ? `${t.slice(0, 140)}…` : t || '');
  return (
    <div className="sgui-followup is-checkin-done">
      <div className="sgui-followup-time">
        <span className="sgui-state is-checkin"><CheckCircle2 size={13} /> تمت</span>
        <b>{d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })}</b>
        <small>{d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' })}</small>
      </div>
      <div className="sgui-followup-main">
        <h3><Link to={`/clients/${f.clientId}`}>{f.clientName}</Link></h3>
        <dl>
          <div><dt><MessageCircle size={13} /> اتعملت فين</dt><dd>{CommMethodLabels[f.method]?.ar || f.method}</dd></div>
          <div><dt><UserCheck size={13} /> السيلز</dt><dd>{f.agentName}</dd></div>
        </dl>
        {(f.result || f.note) && (
          <p className="text-xs font-semibold mt-2 leading-relaxed" style={{ color: 'var(--sg-muted)' }}>
            {f.result && <>النتيجة: {excerpt(f.result)}</>}{f.result && f.note ? ' · ' : ''}{f.note && <>ملاحظات: {excerpt(f.note)}</>}
          </p>
        )}
      </div>
    </div>
  );
};

const EmptyState = ({ message, icon: Icon }: any) => <SharedEmpty icon={Icon}>{message}</SharedEmpty>;

export default Notifications;
