
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, getDocs, orderBy, limit, doc, updateDoc } from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { Client, User, UserRole, Service } from '../types';
import { Calendar, CheckCircle, Clock, BellRing, Filter, BookOpen, User as UserIcon, PhoneCall, CalendarPlus, AlertCircle, X, Search, Clock4, Timer, Hash, UserCheck } from 'lucide-react';
import FloatingPanel from '../components/FloatingPanel';
import { useNavigate } from 'react-router-dom';

const Notifications: React.FC = () => {
  const { user, effectiveRole } = useAuth();
  const navigate = useNavigate();
  
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
      q = query(clientsRef, where('nextFollowUpDate', '>', 0), orderBy('nextFollowUpDate', 'asc'), limit(500));
    } else {
      q = query(clientsRef, where('salesAgentId', '==', user.uid), where('nextFollowUpDate', '>', 0), orderBy('nextFollowUpDate', 'asc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTasks(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
      setLoading(false);
    }, (error) => {
      console.error("Firestore Error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, effectiveRole]);

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
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in pb-20">
      <header>
        <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter uppercase">المهام والمتابعات</h1>
        <p className="text-slate-500 font-bold mt-1">إدارة الجدول الزمني بدقة متناهية</p>
      </header>

      {/* Filters Panel */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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
            className={`w-full py-3 rounded-xl font-black text-[10px] transition-all border-2 ${showOnlyOverdue ? 'bg-rose-500 border-rose-500 text-white shadow-lg' : 'bg-transparent border-slate-100 dark:border-slate-800 text-slate-400'}`}
          >
            {showOnlyOverdue ? 'عرض المتأخر فقط' : 'كل المواعيد'}
          </button>
        </div>
        <div className="flex items-end">
          <button onClick={() => {setFilterDate(''); setFilterServiceId('all'); setFilterAgentId('all'); setShowOnlyOverdue(false);}} className="text-slate-400 text-[10px] font-black underline w-full pb-3">تصفير الفلاتر</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-12">
        <section className="space-y-6">
          <div className="flex items-center justify-between">
             <h2 className="text-2xl font-black flex items-center gap-3">
               <AlertCircle className="text-rose-500" /> متابعات عاجلة اليوم 
               <span className="text-xs bg-rose-500 text-white px-3 py-1 rounded-full">{urgentTasks.length}</span>
             </h2>
          </div>
          <div className="space-y-8">
            {urgentTasks.length === 0 ? (
              <EmptyState message="لا يوجد متابعات عاجلة حالياً" icon={CheckCircle} color="text-emerald-500" />
            ) : (
              urgentTasks.map(task => (
                <TaskCard 
                  key={task.id} 
                  task={task} 
                  onContact={() => navigate(`/clients/${task.id}`)}
                  onReschedule={() => { setRescheduleClient(task); setNewDate(new Date(task.nextFollowUpDate!).toISOString().split('T')[0]); }}
                />
              ))
            )}
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-10">
             <h2 className="text-2xl font-black flex items-center gap-3">
               <Clock className="text-primary-500" /> المتابعات القادمة 
               <span className="text-xs bg-slate-200 dark:bg-slate-800 text-slate-500 px-3 py-1 rounded-full">{upcomingTasks.length}</span>
             </h2>
          </div>
          <div className="space-y-8">
            {upcomingTasks.length === 0 ? (
              <EmptyState message="لا توجد متابعات قادمة مجدولة" icon={Calendar} color="text-slate-300" />
            ) : (
              upcomingTasks.map(task => (
                <TaskCard 
                  key={task.id} 
                  task={task} 
                  onContact={() => navigate(`/clients/${task.id}`)}
                  onReschedule={() => { setRescheduleClient(task); setNewDate(new Date(task.nextFollowUpDate!).toISOString().split('T')[0]); }}
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
               <button onClick={handleReschedule} disabled={loading} className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:bg-primary-600 transition-all active:scale-[0.98] disabled:opacity-50">تحديث الموعد</button>
             </div>
      </FloatingPanel>
    </div>
  );
};

const TaskCard: React.FC<{ 
  task: Client; 
  onContact: () => void; 
  onReschedule: () => void; 
}> = ({ task, onContact, onReschedule }) => {
  const now = Date.now();
  const taskTime = task.nextFollowUpDate || 0;
  const isOverdue = taskTime < now;
  const isToday = new Date(taskTime).toDateString() === new Date().toDateString();

  const d = new Date(taskTime);
  const dateStr = d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
  const hours = d.getHours() % 12 || 12;
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const period = d.getHours() >= 12 ? 'مساءً' : 'صباحاً';

  const timeStatusColor = isOverdue ? 'bg-rose-500 text-white shadow-rose-500/20' : (isToday ? 'bg-amber-500 text-white shadow-amber-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300');

  return (
    <div className={`bg-white dark:bg-slate-900 p-2 md:p-3 rounded-[3.5rem] border-2 transition-all hover:shadow-2xl flex flex-col md:flex-row items-stretch gap-2 ${isOverdue ? 'border-rose-200 dark:border-rose-900/40 shadow-rose-500/10' : 'border-slate-100 dark:border-slate-800'}`}>
      
      {/* Time Block Section */}
      <div className={`flex flex-col items-center justify-center p-6 md:p-8 rounded-[3rem] md:w-60 shrink-0 shadow-lg ${timeStatusColor}`}>
        <p className="text-[10px] font-black uppercase opacity-80 mb-3 flex items-center gap-1.5">
          <Clock4 size={14} /> {isOverdue ? 'تجاوز الموعد' : (isToday ? 'موعد اليوم' : 'موعد قادم')}
        </p>
        <div className="flex items-baseline gap-1">
          <span className="text-5xl font-black tracking-tighter">{hours}:{minutes}</span>
          <span className="text-sm font-black">{period}</span>
        </div>
        <p className="text-[11px] font-black mt-4 opacity-90 border-t border-white/20 pt-3 w-full text-center leading-tight">{dateStr}</p>
        {isOverdue && (
           <div className="mt-5 bg-white/25 px-4 py-1.5 rounded-full flex items-center gap-2 border border-white/20">
              <Timer size={14} className="animate-spin-slow" />
              <span className="text-[10px] font-black uppercase tracking-tighter">اتصال عاجل</span>
           </div>
        )}
      </div>

      {/* Info Section */}
      <div className="flex-1 p-6 md:p-10 flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="text-center md:text-right flex-1 space-y-6">
          
          {/* Client Name with Label */}
          <div>
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1.5 block">اسم العميل بالكامل</label>
            <div className="flex items-center justify-center md:justify-start gap-4">
              <h3 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white leading-none">{task.name}</h3>
              {isOverdue && <span className="w-3.5 h-3.5 bg-rose-500 rounded-full animate-ping shrink-0 shadow-lg shadow-rose-500/50"></span>}
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2">
             <div className="space-y-1.5">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center justify-center md:justify-start gap-1">
                  <BookOpen size={10} className="text-primary-500"/> الخدمة المطلوبة
                </label>
                <span className="bg-slate-50 dark:bg-slate-800 px-4 py-2.5 rounded-xl text-[11px] font-black text-slate-700 dark:text-slate-200 block border border-slate-100 dark:border-slate-700">
                   {task.serviceName}
                </span>
             </div>
             <div className="space-y-1.5">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center justify-center md:justify-start gap-1">
                  <UserCheck size={10} className="text-primary-500"/> موظف المبيعات (Sales)
                </label>
                <span className="bg-slate-50 dark:bg-slate-800 px-4 py-2.5 rounded-xl text-[11px] font-black text-slate-700 dark:text-slate-200 block border border-slate-100 dark:border-slate-700">
                   {task.salesAgentName}
                </span>
             </div>
             <div className="space-y-1.5">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest flex items-center justify-center md:justify-start gap-1">
                  <Hash size={10} className="text-primary-500"/> رقم الهاتف
                </label>
                <span className="bg-slate-50 dark:bg-slate-800 px-4 py-2.5 rounded-xl text-[11px] font-black text-slate-600 dark:text-slate-300 block font-mono tracking-widest border border-slate-100 dark:border-slate-700" dir="ltr">
                   {task.phone}
                </span>
             </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3 w-full md:w-auto shrink-0">
          <button 
            onClick={onReschedule}
            className="w-full md:w-48 px-6 py-5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-3xl text-[10px] font-black hover:bg-slate-200 transition-all flex items-center justify-center gap-2.5 border border-slate-200 dark:border-slate-700 group"
          >
            <CalendarPlus size={20} className="group-hover:rotate-12 transition-transform"/> إعادة جدولة
          </button>
          <button 
            onClick={onContact}
            className={`w-full md:w-48 px-6 py-5 rounded-3xl text-[11px] font-black text-white shadow-2xl hover:scale-[1.03] transition-all flex items-center justify-center gap-2.5 ${isOverdue ? 'bg-rose-500 shadow-rose-500/30' : 'bg-primary-500 shadow-primary-500/30'}`}
          >
            <PhoneCall size={20} className="animate-pulse" /> تواصل الآن
          </button>
        </div>
      </div>
    </div>
  );
};

const EmptyState = ({ message, icon: Icon, color }: any) => (
  <div className="bg-white dark:bg-slate-900 p-16 rounded-[4rem] border-2 border-dashed border-slate-100 dark:border-slate-800 text-center space-y-4 shadow-sm">
    <div className={`w-28 h-28 mx-auto rounded-full flex items-center justify-center bg-slate-50 dark:bg-slate-800 ${color} shadow-inner`}>
      <Icon size={56} />
    </div>
    <h3 className="text-xl font-black text-slate-400">{message}</h3>
  </div>
);

export default Notifications;
