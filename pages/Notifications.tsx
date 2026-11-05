
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, getDocs, orderBy, limit, doc, updateDoc } from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { Client, User, UserRole, Service } from '../types';
import { Calendar, CheckCircle, Clock, BellRing, Filter, BookOpen, User as UserIcon, PhoneCall, CalendarPlus, AlertCircle, X, Search, Clock4, Timer, Hash, UserCheck } from 'lucide-react';
import { PageHeader, SectionTitle, Badge, EmptyState as SharedEmpty } from '../components/ui';
import FloatingPanel from '../components/FloatingPanel';
import AcceptFlowModal from '../components/AcceptFlowModal';
import { useNavigate } from 'react-router-dom';

const Notifications: React.FC = () => {
  const { user, effectiveRole, effectiveUser } = useAuth();
  const navigate = useNavigate();

  const [acceptFlowClient, setAcceptFlowClient] = useState<Client | null>(null);

  // Data States
  const [tasks, setTasks] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [salesAgents, setSalesAgents] = useState<{id: string, name: string}[]>([]);
  
  // Filter States
  const [filterServiceId, setFilterServiceId] = useState<string>('all');
  const [filterAgentId, setFilterAgentId] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>('');
  const [showOnlyOverdue, setShowOnlyOverdue] = useState(false);
  
  // UI States
  const [loading, setLoading] = useState(true);
  const [rescheduleClient, setRescheduleClient] = useState<Client | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('10:00');
  const [newPeriod, setNewPeriod] = useState<'AM' | 'PM'>('AM');

  const isHighRole = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER || effectiveRole === UserRole.TEAM_LEADER;

  useEffect(() => {
    const unsubServices = onSnapshot(query(collection(db, 'services'), where('isActive', '==', true)), snap => {
      setServices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Service)));
    }, (err) => {
      console.error("Notifications Services Snapshot Error:", err);
    });

    if (isHighRole) {
      getDocs(query(collection(db, 'users'), where('role', 'in', [UserRole.SALES_AGENT, UserRole.TEAM_LEADER, UserRole.SUPERVISOR]))).then(snap => {
        const activeAgents = snap.docs
          .map(d => ({ uid: d.id, id: d.id, ...d.data() } as any))
          .filter(u => !u.isDeactivated)
          .map(u => ({ id: u.uid || u.id, name: u.name || u.email || 'بدون اسم' }));
        setSalesAgents(activeAgents);
      });
    }

    return () => unsubServices();
  }, [isHighRole]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    
    const clientsRef = collection(db, 'clients');
    let q;

    if (isHighRole) {
      // Capped and ordered by date: the nearest/most overdue tasks come first.
      q = query(clientsRef, where('nextFollowUpDate', '>', 0), orderBy('nextFollowUpDate', 'asc'), limit(300));
    } else {
      // Viewing as a specific agent (effectiveUser) scopes to their data,
      // not the real admin's -- see setViewingAsUser in App.tsx.
      q = query(clientsRef, where('salesAgentId', '==', effectiveUser?.uid || user.uid), where('nextFollowUpDate', '>', 0), orderBy('nextFollowUpDate', 'asc'), limit(300));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTasks(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
      setLoading(false);
    }, (error) => {
      console.error("Firestore Error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, effectiveRole, effectiveUser]);

  const { urgentTasks, upcomingTasks } = useMemo(() => {
    const now = Date.now();
    const endOfToday = new Date().setHours(23, 59, 59, 999);

    const filtered = tasks.filter(task => {
      const matchesService = filterServiceId === 'all' || task.serviceId === filterServiceId;
      const matchesAgent = filterAgentId === 'all' || task.salesAgentId === filterAgentId;
      
      let matchesDate = true;
      if (filterDate) {
        const d = new Date(task.nextFollowUpDate!);
        const filterD = new Date(filterDate);
        matchesDate = d.toDateString() === filterD.toDateString();
      }

      const isOverdue = task.nextFollowUpDate! < now;
      const matchesOverdue = !showOnlyOverdue || isOverdue;

      return matchesService && matchesAgent && matchesDate && matchesOverdue;
    });

    return {
      urgentTasks: filtered.filter(t => t.nextFollowUpDate! <= endOfToday),
      upcomingTasks: filtered.filter(t => t.nextFollowUpDate! > endOfToday)
    };
  }, [tasks, filterServiceId, filterAgentId, filterDate, showOnlyOverdue]);

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
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sg-page animate-fade-in">
      <PageHeader title="المهام والمتابعات" subtitle="كل مواعيد المتابعة: العاجل الأول وبعده الجاي" />

      {/* Filters Panel */}
      <div className="sgui-filter-panel grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <div className="space-y-1">
          <label className="text-[10px] font-black text-slate-400 uppercase mr-2 flex items-center gap-1"><Calendar size={12}/> التاريخ</label>
          <input type="date" className="w-full bg-slate-50 dark:bg-slate-800 p-3 rounded-xl font-bold text-xs outline-none text-slate-900 dark:text-white" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black text-slate-400 uppercase mr-2 flex items-center gap-1"><BookOpen size={12}/> الخدمة</label>
          <select className="w-full bg-slate-50 dark:bg-slate-800 p-3 rounded-xl font-bold text-xs outline-none text-slate-900 dark:text-white" value={filterServiceId} onChange={e => setFilterServiceId(e.target.value)}>
            <option value="all">كل الخدمات</option>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {isHighRole && (
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase mr-2 flex items-center gap-1"><UserIcon size={12}/> الموظف</label>
            <select className="w-full bg-slate-50 dark:bg-slate-800 p-3 rounded-xl font-bold text-xs outline-none text-slate-900 dark:text-white" value={filterAgentId} onChange={e => setFilterAgentId(e.target.value)}>
              <option value="all">كل الموظفين</option>
              {salesAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
        <div className="lg:col-span-1 flex items-end">
          <button 
            onClick={() => setShowOnlyOverdue(!showOnlyOverdue)}
            aria-pressed={showOnlyOverdue}
            className={`sgui-button w-full ${showOnlyOverdue ? 'is-danger' : ''}`}
          >
            {showOnlyOverdue ? 'عرض المتأخر فقط' : 'كل المواعيد'}
          </button>
        </div>
        <div className="flex items-end">
          <button onClick={() => {setFilterDate(''); setFilterServiceId('all'); setFilterAgentId('all'); setShowOnlyOverdue(false);}} className="sgui-button w-full">تصفير الفلاتر</button>
        </div>
      </div>

      <div>
        <section>
          <SectionTitle icon={<AlertCircle size={18} className="text-rose-500" />} title="متابعات عاجلة النهارده" count={urgentTasks.length} />
          <div className="sgui-list">
            {urgentTasks.length === 0 ? (
              <EmptyState message="لا يوجد متابعات عاجلة حالياً" icon={CheckCircle} color="text-emerald-500" />
            ) : (
              urgentTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onContact={() => navigate(`/clients/${task.id}`)}
                  onReschedule={() => { setRescheduleClient(task); setNewDate(new Date(task.nextFollowUpDate!).toISOString().split('T')[0]); }}
                  onAccept={() => setAcceptFlowClient(task)}
                />
              ))
            )}
          </div>
        </section>

        <section>
          <SectionTitle icon={<Clock size={18} className="text-primary-500" />} title="المتابعات الجاية" count={upcomingTasks.length} />
          <div className="sgui-list">
            {upcomingTasks.length === 0 ? (
              <EmptyState message="لا توجد متابعات قادمة مجدولة" icon={Calendar} color="text-slate-300" />
            ) : (
              upcomingTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onContact={() => navigate(`/clients/${task.id}`)}
                  onReschedule={() => { setRescheduleClient(task); setNewDate(new Date(task.nextFollowUpDate!).toISOString().split('T')[0]); }}
                  onAccept={() => setAcceptFlowClient(task)}
                />
              ))
            )}
          </div>
        </section>
      </div>

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
