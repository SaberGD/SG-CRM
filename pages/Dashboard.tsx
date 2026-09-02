
import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../App';
import { Client, User, UserRole, ClientStatus } from '../types';
import { 
  Users, Calendar, PhoneCall, Clock, CalendarDays, AlertTriangle, Filter, ArrowRightLeft, Timer, ChevronLeft, BellRing, Clock4, History, CheckCircle2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ManualFollowUpModal from '../components/ManualFollowUpModal';

const Dashboard: React.FC = () => {
  const { user, effectiveRole } = useAuth();
  const navigate = useNavigate();
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
    let q;
    
    // القواعد تفرض قيوداً: إذا لم يكن مديراً، يجب أن يفلتر دائماً حسب المعرف الخاص به
    if (isHighRole && selectedAgentId === 'all') {
      q = query(clientsRef);
    } else if (isHighRole && selectedAgentId !== 'all') {
      q = query(clientsRef, where('salesAgentId', '==', selectedAgentId));
    } else {
      q = query(clientsRef, where('salesAgentId', '==', user.uid));
    }

    const unsub = onSnapshot(q, (snapshot) => {
      const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Client));
      const now = Date.now();
      const todayStart = new Date().setHours(0,0,0,0);
      const todayEnd = new Date().setHours(23,59,59,999);
      
      const bookedCount = all.filter(c => c.isBooked || c.status === ClientStatus.BOOKED).length;

      setStats(prev => ({
        ...prev,
        total: all.length,
        today: all.filter(c => c.nextFollowUpDate && c.nextFollowUpDate >= todayStart && c.nextFollowUpDate <= todayEnd).length,
        upcoming: all.filter(c => c.nextFollowUpDate && c.nextFollowUpDate > todayEnd).length,
        overdue: all.filter(c => c.nextFollowUpDate && c.nextFollowUpDate < now).length,
        booked: bookedCount,
      }));
      setClients(all);
      setLoading(false);
    }, (err) => {
      console.error("Dashboard Snapshot Error:", err);
      setError("لا تملك صلاحية كافية لعرض كافة هذه البيانات أو انتهت جلسة العمل.");
      setLoading(false);
    });

    if (isHighRole) {
      const todayStart = new Date().setHours(0,0,0,0);
      getDocs(query(collection(db, 'transfers'), where('timestamp', '>=', todayStart)))
        .then(tSnap => {
          setStats(prev => ({ ...prev, transfersToday: tSnap.size }));
        })
        .catch(() => console.warn("Could not fetch transfers stats."));
    }

    return () => unsub();
  }, [user, effectiveRole, selectedAgentId]);

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

  if (loading) return <div className="text-center py-40 animate-pulse font-black text-primary-500 uppercase tracking-widest">جاري تحميل البيانات الذكية...</div>;

  if (error) return (
    <div className="text-center py-40 space-y-4">
      <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto"><AlertTriangle size={40}/></div>
      <h2 className="text-xl font-black text-rose-500">{error}</h2>
      <button onClick={() => window.location.reload()} className="px-6 py-3 bg-primary-500 text-white rounded-xl font-black text-xs">تحديث الصفحة</button>
    </div>
  );

  return (
    <div className="sg-page space-y-7 animate-fade-in">
      <header className="sg-page-header">
        <div>
          <h1 className="sg-title">لوحة <span className="text-primary-500">التحكم</span></h1>
          <p className="sg-subtitle">مرحباً {user?.name ? user.name.split(' ')[0] : 'بك'}، إليك ملخص المهام والمتابعات المهمة</p>
        </div>
        {isHighRole && (
          <div className="sg-surface flex items-center gap-3 px-4 py-3">
            <Filter size={18} className="text-primary-500" />
            <select className="bg-transparent text-xs font-black outline-none border-none text-slate-900 dark:text-white" value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)}>
              <option value="all">كل فريق المبيعات</option>
              {salesAgents.map(agent => <option key={agent.uid} value={agent.uid}>{agent.name}</option>)}
            </select>
          </div>
        )}
      </header>

      {emergencyTasks.length > 0 && (
        <section className="space-y-4">
          <div className="flex justify-between items-center px-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-500 text-white rounded-xl animate-pulse"><AlertTriangle size={20}/></div>
              <h2 className="text-xl font-black">متابعات عاجلة جداً <span className="text-rose-500">(فائتة)</span></h2>
            </div>
            <button onClick={() => { setActiveTab('overdue'); document.getElementById('tasks-table')?.scrollIntoView({ behavior: 'smooth' }); }} className="text-slate-400 hover:text-primary-500 transition-colors flex items-center gap-2 text-[10px] font-black uppercase">عرض الكل <ChevronLeft size={14}/></button>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {emergencyTasks.map(task => (
              <TaskCard key={task.id} task={task} type="emergency" onManualLog={() => setSelectedClientForManual(task)} />
            ))}
          </div>
        </section>
      )}

      {todayTasks.length > 0 && (
        <section className="space-y-4">
          <div className="flex justify-between items-center px-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500 text-white rounded-xl"><Calendar size={20}/></div>
              <h2 className="text-xl font-black">متابعات <span className="text-emerald-500">اليوم</span> المجدولة</h2>
            </div>
            <button onClick={() => { setActiveTab('today'); document.getElementById('tasks-table')?.scrollIntoView({ behavior: 'smooth' }); }} className="text-slate-400 hover:text-primary-500 transition-colors flex items-center gap-2 text-[10px] font-black uppercase">عرض الكل <ChevronLeft size={14}/></button>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {todayTasks.map(task => (
              <TaskCard key={task.id} task={task} type="today" onManualLog={() => setSelectedClientForManual(task)} />
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <QuickStat icon={Users} label="إجمالي العملاء" value={stats.total} color="bg-blue-500" />
        <QuickStat icon={CheckCircle2} label="إجمالي الحجوزات" value={stats.booked} color="bg-teal-500" />
        <QuickStat icon={Calendar} label="متابعات اليوم" value={stats.today} color="bg-emerald-500" highlight={stats.overdue > 0} />
        <QuickStat icon={Clock} label="المجدولة مستقبلاً" value={stats.upcoming} color="bg-primary-500" />
        <QuickStat icon={AlertTriangle} label="إجمالي المتأخرات" value={stats.overdue} color="bg-rose-500" animate={stats.overdue > 0} />
        {isHighRole && <QuickStat icon={ArrowRightLeft} label="تحويلات اليوم" value={stats.transfersToday} color="bg-amber-500" />}
      </div>

      <div id="tasks-table" className="sg-surface p-5 relative">
        <div className="flex flex-wrap gap-3 mb-6 border-b border-slate-100 dark:border-slate-800 pb-4 overflow-x-auto no-scrollbar">
          <TabBtn active={activeTab === 'today'} onClick={() => setActiveTab('today')} label="متابعات اليوم الكاملة" count={stats.today} icon={Calendar} />
          <TabBtn active={activeTab === 'overdue'} onClick={() => setActiveTab('overdue')} label="كل المتأخرات" count={stats.overdue} icon={AlertTriangle} danger={stats.overdue > 0} />
          <TabBtn active={activeTab === '3days'} onClick={() => setActiveTab('3days')} label="قادمة (3 أيام)" icon={CalendarDays} />
          <TabBtn active={activeTab === 'upcoming'} onClick={() => setActiveTab('upcoming')} label="الجدول الزمني الكامل" icon={Clock} />
        </div>
        
        <div className="space-y-4">
          {filteredTasks.length === 0 ? (
            <div className="py-20 text-center text-slate-400 font-bold italic flex flex-col items-center gap-4">
               <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-full text-slate-200"><BellRing size={48}/></div>
               لا توجد متابعات مسجلة في هذا التصنيف حالياً
            </div>
          ) : filteredTasks.map(task => {
            const isOverdue = (task.nextFollowUpDate || 0) < Date.now();
            return (
              <div key={task.id} onClick={() => navigate(`/clients/${task.id}`)} className={`group flex items-center p-4 rounded-2xl border transition-all cursor-pointer ${isOverdue ? 'bg-rose-50/30 dark:bg-rose-500/5 border-rose-100 dark:border-rose-500/10 hover:border-rose-300' : 'bg-slate-50 dark:bg-slate-800/50 border-transparent hover:border-primary-500/30'}`}>
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shadow-sm ml-4 transition-transform ${isOverdue ? 'bg-rose-500 text-white' : 'bg-white dark:bg-slate-800 text-primary-500'}`}>
                  {isOverdue ? <AlertTriangle size={20} className="animate-pulse" /> : <PhoneCall size={20} />}
                </div>
                <div className="flex-1 px-4 text-right">
                  <div className="flex items-center gap-2">
                    <h4 className="font-black text-sm">{task.name}</h4>
                    {isOverdue && <span className="text-[8px] font-black bg-rose-500 text-white px-2 py-0.5 rounded-full animate-bounce">متأخر</span>}
                  </div>
                  <p className="text-xs text-slate-400 font-bold mt-0.5" dir="ltr">{task.phone} • {task.serviceName}</p>
                </div>
                <div className="text-left shrink-0">
                  <p className={`text-xs font-black mb-1 ${isOverdue ? 'text-rose-500' : 'text-primary-500'}`}>
                    {new Date(task.nextFollowUpDate!).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                  </p>
                  <div className="flex items-center gap-2 justify-end">
                    <span className="text-[10px] font-black uppercase text-slate-400">بواسطة: {task.salesAgentName}</span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedClientForManual(task);
                      }}
                      className="sg-icon-btn !w-8 !h-8 bg-white dark:bg-slate-800 text-slate-400 hover:text-primary-500"
                      title="تم التواصل مسبقاً"
                    >
                      <History size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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

const QuickStat = ({ icon: Icon, label, value, color, highlight, animate }: any) => (
  <div className={`sg-surface p-5 flex items-center gap-4 transition-all ${highlight ? 'border-amber-400 ring-4 ring-amber-500/5' : ''}`}>
    <div className={`w-11 h-11 ${color} text-white rounded-xl flex items-center justify-center ${animate ? 'animate-pulse' : ''}`}><Icon size={22}/></div>
    <div><p className="text-[10px] font-black text-slate-400 uppercase mb-1">{label}</p><p className="text-2xl font-black text-slate-900 dark:text-white">{value}</p></div>
  </div>
);

const TaskCard: React.FC<{ task: Client, type: 'emergency' | 'today', onManualLog: () => void }> = ({ task, type, onManualLog }) => {
  const navigate = useNavigate();
  const d = new Date(task.nextFollowUpDate!);
  const hours = d.getHours() % 12 || 12;
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const period = d.getHours() >= 12 ? 'مساءً' : 'صباحاً';
  const dateStr = d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
  const isEmergency = type === 'emergency';

  return (
    <div 
      onClick={() => navigate(`/clients/${task.id}`)}
      className={`sg-surface overflow-hidden group cursor-pointer transition-all active:scale-[0.99] ${isEmergency ? 'border-rose-100 dark:border-rose-900/30' : 'border-emerald-100 dark:border-emerald-900/30'}`}
    >
       <div className="flex flex-col">
          <div className={`${isEmergency ? 'bg-rose-500' : 'bg-emerald-500'} p-6 text-white text-center relative overflow-hidden`}>
            <div className="absolute top-0 right-0 p-4 opacity-20"><Clock4 size={64}/></div>
            <p className="text-[10px] font-black uppercase opacity-85 mb-2 flex items-center justify-center gap-2">
              {isEmergency ? <><Timer size={14} className="animate-spin-slow"/> تجاوز الموعد منذ</> : <><Calendar size={14}/> موعد التواصل اليوم</>}
            </p>
            <div className="flex items-baseline justify-center gap-2">
              <span className="text-4xl font-black">{hours}:{minutes}</span>
              <span className="text-sm font-black">{period}</span>
            </div>
            <div className="mt-4 pt-3 border-t border-white/20">
              <p className="text-[11px] font-black opacity-90">{dateStr}</p>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="text-center">
              <h3 className="text-lg font-black text-slate-900 dark:text-white truncate">{task.name}</h3>
              <p className="text-[10px] font-black text-slate-400 mt-1 uppercase">{task.serviceName}</p>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-slate-50 dark:border-slate-800">
               <div className="flex items-center gap-2">
                 <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center text-primary-500 font-black text-[10px]">{task.salesAgentName?.[0] || '?'}</div>
                 <span className="text-[10px] font-black text-slate-400">{task.salesAgentName}</span>
               </div>
               <div className="flex gap-2">
                 <button 
                   onClick={(e) => {
                     e.stopPropagation();
                     onManualLog();
                   }}
                   className="sg-icon-btn bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-primary-500 hover:text-white"
                   title="تم التواصل مسبقاً"
                 >
                   <History size={18} />
                 </button>
                 <div className={`sg-icon-btn ${isEmergency ? 'bg-rose-50 text-rose-500 group-hover:bg-rose-500 group-hover:text-white' : 'bg-emerald-50 text-emerald-500 group-hover:bg-emerald-500 group-hover:text-white'}`}>
                   <PhoneCall size={18} />
                 </div>
               </div>
            </div>
          </div>
       </div>
    </div>
  );
};

const TabBtn = ({ active, onClick, label, count, icon: Icon, danger }: any) => (
  <button onClick={onClick} className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[10px] md:text-xs font-black transition-all shrink-0 ${active ? 'bg-primary-500 text-white shadow-xl shadow-primary-500/20' : (danger ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-500' : 'bg-slate-50 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white')}`}>
    <Icon size={16} />{label}{count !== undefined && <span className={`mr-2 px-2 py-0.5 rounded-full text-[10px] ${active ? 'bg-white text-primary-500' : (danger ? 'bg-rose-500 text-white' : 'bg-slate-200 text-slate-500')}`}>{count}</span>}
  </button>
);

export default Dashboard;
