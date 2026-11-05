
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, orderBy, limit, getCountFromServer, QueryConstraint } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../App';
import { Client, User, UserRole, ClientStatus } from '../types';
import {
  Users, Calendar, PhoneCall, Clock, CalendarDays, AlertTriangle, Filter, ArrowRightLeft, ChevronLeft, BellRing, History, CheckCircle2, PlayCircle, Square, Coffee
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ManualFollowUpModal from '../components/ManualFollowUpModal';
import { PageHeader, SectionTitle, StatCard, Badge, Tabs, EmptyState, LoadingState } from '../components/ui';
import { useShift } from '../ShiftContext';

const Dashboard: React.FC = () => {
  const { user, effectiveRole, effectiveUser } = useAuth();
  const navigate = useNavigate();
  const { shift, isShiftApplicable, openGate, openEndModal, startBreak, endBreak, startNewShift } = useShift();
  const [stats, setStats] = useState({ total: 0, today: 0, upcoming: 0, overdue: 0, transfersToday: 0, booked: 0 });
  const [clients, setClients] = useState<Client[]>([]);
  const [salesAgents, setSalesAgents] = useState<User[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'today' | '3days' | 'upcoming' | 'overdue'>('today');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedClientForManual, setSelectedClientForManual] = useState<Client | null>(null);

  const isAdminOrManager = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER;
  const isHighRole = isAdminOrManager || effectiveRole === UserRole.TEAM_LEADER;

  useEffect(() => {
    if (isHighRole) fetchAgents();
  }, [effectiveRole]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    
    const clientsRef = collection(db, 'clients');
    // Reads are kept low (same rule as the accounting system): the numbers come from
    // server-side counts (1 read per 1,000 clients) and the task lists read only the
    // clients that actually have a follow-up date in range, capped and sorted.
    // Before this, every open of the dashboard read ALL clients through a live listener.
    const agentId = isHighRole && selectedAgentId !== 'all' ? selectedAgentId : (effectiveUser?.uid || user.uid);
    const scope: QueryConstraint[] = isHighRole && selectedAgentId === 'all' ? [] : [where('salesAgentId', '==', agentId)];
    let cancelled = false;
    (async () => {
      try {
        const now = Date.now();
        const todayStart = new Date().setHours(0, 0, 0, 0);
        const todayEnd = new Date().setHours(23, 59, 59, 999);
        const count = (extra: QueryConstraint[]) => getCountFromServer(query(clientsRef, ...scope, ...extra)).then((r) => r.data().count);
        const [total, today, upcoming, overdue, booked] = await Promise.all([
          count([]),
          count([where('nextFollowUpDate', '>=', todayStart), where('nextFollowUpDate', '<=', todayEnd)]),
          count([where('nextFollowUpDate', '>', todayEnd)]),
          count([where('nextFollowUpDate', '>', 0), where('nextFollowUpDate', '<', now)]),
          count([where('status', '==', ClientStatus.BOOKED)]),
        ]);
        const [overdueSnap, futureSnap] = await Promise.all([
          getDocs(query(clientsRef, ...scope, where('nextFollowUpDate', '>', 0), where('nextFollowUpDate', '<', now), orderBy('nextFollowUpDate', 'asc'), limit(100))),
          getDocs(query(clientsRef, ...scope, where('nextFollowUpDate', '>=', now), orderBy('nextFollowUpDate', 'asc'), limit(150))),
        ]);
        if (cancelled) return;
        setStats(prev => ({ ...prev, total, today, upcoming, overdue, booked }));
        setClients([...overdueSnap.docs, ...futureSnap.docs].map(d => ({ id: d.id, ...d.data() } as Client)));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("Dashboard load error:", err);
        setError("لا تملك صلاحية كافية لعرض كافة هذه البيانات أو انتهت جلسة العمل.");
        setLoading(false);
      }
    })();

    if (isHighRole) {
      const todayStart = new Date().setHours(0,0,0,0);
      getDocs(query(collection(db, 'transfers'), where('timestamp', '>=', todayStart)))
        .then(tSnap => {
          setStats(prev => ({ ...prev, transfersToday: tSnap.size }));
        })
        .catch(() => console.warn("Could not fetch transfers stats."));
    }

    return () => { cancelled = true; };
  }, [user, effectiveRole, effectiveUser, selectedAgentId]);

  const fetchAgents = async () => {
    try {
      const q = query(collection(db, 'users'));
      const snap = await getDocs(q);
      const activeAgents = snap.docs
        .map(d => ({ uid: d.id, ...d.data() } as User))
        .filter(u => !u.isDeactivated && (u.role === UserRole.SALES_AGENT || u.role === UserRole.TEAM_LEADER || u.role === UserRole.SUPERVISOR));
      setSalesAgents(activeAgents);
    } catch (e) {
      console.warn("Permission denied for agents list.");
    }
  };

  const emergencyTasks = useMemo(() => {
    const now = Date.now();
    return clients
      .filter(c => c.nextFollowUpDate && c.nextFollowUpDate < now)
      .sort((a,b) => (a.nextFollowUpDate || 0) - (b.nextFollowUpDate || 0))
      .slice(0, 3);
  }, [clients]);

  const todayTasks = useMemo(() => {
    const todayStart = new Date().setHours(0,0,0,0);
    const todayEnd = new Date().setHours(23,59,59,999);
    const now = Date.now();
    return clients
      .filter(c => c.nextFollowUpDate && c.nextFollowUpDate >= todayStart && c.nextFollowUpDate <= todayEnd && c.nextFollowUpDate >= now)
      .sort((a,b) => (a.nextFollowUpDate || 0) - (b.nextFollowUpDate || 0))
      .slice(0, 3);
  }, [clients]);

  const filteredTasks = useMemo(() => {
    return clients.filter(c => {
      if (!c.nextFollowUpDate) return false;
      const now = Date.now();
      const todayStart = new Date().setHours(0,0,0,0);
      const todayEnd = new Date().setHours(23,59,59,999);
      
      if (activeTab === 'today') return c.nextFollowUpDate >= todayStart && c.nextFollowUpDate <= todayEnd;
      if (activeTab === 'overdue') return c.nextFollowUpDate < now;
      if (activeTab === '3days') return c.nextFollowUpDate > now && c.nextFollowUpDate <= (now + 3 * 24 * 60 * 60 * 1000);
      return c.nextFollowUpDate > todayEnd;
    }).sort((a,b) => (a.nextFollowUpDate || 0) - (b.nextFollowUpDate || 0));
  }, [clients, activeTab]);

  if (loading) return <LoadingState label="جاري تحميل لوحة التحكم..." />;

  if (error) return (
    <EmptyState icon={AlertTriangle}>
      <p className="mb-3">{error}</p>
      <button onClick={() => window.location.reload()} className="sgui-button is-primary">تحديث الصفحة</button>
    </EmptyState>
  );

  const scrollToTasks = (tab: typeof activeTab) => { setActiveTab(tab); document.getElementById('tasks-table')?.scrollIntoView({ behavior: 'smooth' }); };
  const shiftLabel = !shift ? '' : shift.status === 'reviewing' ? 'لسه ما بدأتش الشيفت النهاردة' : shift.status === 'on_break' ? 'انت في بريك دلوقتي' : shift.status === 'active' ? 'الشيفت شغال' : 'الشيفت خلص النهاردة';
  const shiftTone = !shift ? 'neutral' : shift.status === 'active' ? 'good' : shift.status === 'on_break' ? 'warning' : 'neutral';

  return (
    <div className="sg-page animate-fade-in">
      <PageHeader
        title="لوحة التحكم"
        subtitle={`أهلاً ${user?.name ? user.name.split(' ')[0] : 'بيك'}، ده ملخص المتابعات والمهام المهمة`}
        actions={isHighRole && (
          <label className="sgui-inline-field">
            <Filter size={16} aria-hidden="true" />
            <span className="sr-only">فريق المبيعات</span>
            <select value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)}>
              <option value="all">كل فريق المبيعات</option>
              {salesAgents.map(agent => <option key={agent.uid} value={agent.uid}>{agent.name}</option>)}
            </select>
          </label>
        )}
      />

      {isShiftApplicable && shift && (
        <div className="sgui-shift">
          <div>
            <span>حالة الشيفت</span>
            <strong><Badge tone={shiftTone as any}>{shiftLabel}</Badge></strong>
          </div>
          <div>
            {shift.status === 'reviewing' && <button onClick={openGate} className="sgui-button is-primary"><PlayCircle size={16} /> ابدأ الشيفت</button>}
            {shift.status === 'active' && (
              <>
                <button onClick={startBreak} className="sgui-button"><Coffee size={16} /> بريك</button>
                <button onClick={openEndModal} className="sgui-button is-danger"><Square size={16} /> إنهاء الشيفت</button>
              </>
            )}
            {shift.status === 'on_break' && <button onClick={endBreak} className="sgui-button is-primary"><Coffee size={16} /> إنهاء البريك</button>}
            {shift.status === 'ended' && <button onClick={startNewShift} className="sgui-button is-primary"><PlayCircle size={16} /> ابدأ شيفت جديد</button>}
          </div>
        </div>
      )}

      <div className="sgui-stat-grid">
        <StatCard icon={Users} label="إجمالي العملاء" value={stats.total} />
        <StatCard icon={CheckCircle2} label="إجمالي الحجوزات" value={stats.booked} tone="good" />
        <StatCard icon={Calendar} label="متابعات النهارده" value={stats.today} tone="info" />
        <StatCard icon={Clock} label="مجدولة بعد كده" value={stats.upcoming} />
        <StatCard icon={AlertTriangle} label="متابعات متأخرة" value={stats.overdue} tone={stats.overdue > 0 ? 'danger' : 'neutral'} />
        {isHighRole && <StatCard icon={ArrowRightLeft} label="تحويلات النهارده" value={stats.transfersToday} tone="warning" />}
      </div>

      {emergencyTasks.length > 0 && (
        <section>
          <SectionTitle icon={<AlertTriangle size={18} className="text-rose-500" />} title="متابعات فاتت مواعيدها" count={stats.overdue}
            action={<button type="button" onClick={() => scrollToTasks('overdue')}>عرض الكل <ChevronLeft size={14} className="inline" /></button>} />
          <div className="sgui-task-grid">
            {emergencyTasks.map(task => <TaskCard key={task.id} task={task} type="emergency" onManualLog={() => setSelectedClientForManual(task)} />)}
          </div>
        </section>
      )}

      {todayTasks.length > 0 && (
        <section>
          <SectionTitle icon={<Calendar size={18} className="text-emerald-600" />} title="متابعات النهارده" count={stats.today}
            action={<button type="button" onClick={() => scrollToTasks('today')}>عرض الكل <ChevronLeft size={14} className="inline" /></button>} />
          <div className="sgui-task-grid">
            {todayTasks.map(task => <TaskCard key={task.id} task={task} type="today" onManualLog={() => setSelectedClientForManual(task)} />)}
          </div>
        </section>
      )}

      <section id="tasks-table" className="sgui-panel mt-6 p-4 md:p-5">
        <Tabs label="جدول المتابعات" value={activeTab} onChange={setActiveTab} items={[
          { value: 'today', label: 'متابعات النهارده', count: stats.today, icon: Calendar },
          { value: 'overdue', label: 'كل المتأخرات', count: stats.overdue, icon: AlertTriangle, danger: stats.overdue > 0 },
          { value: '3days', label: 'الـ 3 أيام الجاية', icon: CalendarDays },
          { value: 'upcoming', label: 'كل المواعيد الجاية', icon: Clock },
        ]} />

        {filteredTasks.length === 0 ? (
          <EmptyState icon={BellRing}>مفيش متابعات في التصنيف ده دلوقتي</EmptyState>
        ) : (
          <div className="sgui-list">
            {filteredTasks.map(task => {
              const isOverdue = (task.nextFollowUpDate || 0) < Date.now();
              return (
                <div key={task.id} role="link" tabIndex={0} onClick={() => navigate(`/clients/${task.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/clients/${task.id}`); }} className={`sgui-row ${isOverdue ? 'is-overdue' : ''}`}>
                  <span className="sgui-row-icon">{isOverdue ? <AlertTriangle size={18} /> : <PhoneCall size={18} />}</span>
                  <div className="sgui-row-main">
                    <strong>{task.name}{isOverdue && <Badge tone="danger">متأخر</Badge>}</strong>
                    <small><span dir="ltr">{task.phone}</span> · {task.serviceName}</small>
                  </div>
                  <div className="sgui-row-side">
                    <b>{new Date(task.nextFollowUpDate!).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</b>
                    <span>{task.salesAgentName}</span>
                  </div>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedClientForManual(task); }} className="sgui-icon-button" title="تم التواصل قبل كده" aria-label="تم التواصل قبل كده">
                    <History size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedClientForManual && user && (
        <ManualFollowUpModal
          isOpen={!!selectedClientForManual}
          onClose={() => setSelectedClientForManual(null)}
          client={selectedClientForManual}
          user={user}
        />
      )}
    </div>
  );
};

const TaskCard: React.FC<{ task: Client, type: 'emergency' | 'today', onManualLog: () => void }> = ({ task, type, onManualLog }) => {
  const navigate = useNavigate();
  const d = new Date(task.nextFollowUpDate!);
  const time = d.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
  const dateStr = d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
  const isEmergency = type === 'emergency';

  return (
    <div role="link" tabIndex={0} onClick={() => navigate(`/clients/${task.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/clients/${task.id}`); }} className={`sgui-task ${isEmergency ? 'is-overdue' : 'is-today'}`}>
      <div className="sgui-task-time">
        <b>{time}</b>
        <Badge tone={isEmergency ? 'danger' : 'good'}>{isEmergency ? 'فات الموعد' : 'النهارده'}</Badge>
      </div>
      <div>
        <h3>{task.name}</h3>
        <p>{task.serviceName} · {dateStr}</p>
      </div>
      <div className="sgui-task-foot">
        <span>{task.salesAgentName}</span>
        <span className="flex gap-2">
          <button type="button" onClick={(e) => { e.stopPropagation(); onManualLog(); }} className="sgui-icon-button" title="تم التواصل قبل كده" aria-label="تم التواصل قبل كده"><History size={16} /></button>
          <span className="sgui-icon-button" aria-hidden="true"><PhoneCall size={16} /></span>
        </span>
      </div>
    </div>
  );
};

export default Dashboard;
