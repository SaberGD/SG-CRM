
import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, query, where, getDocs, addDoc, limit, orderBy, 
  doc, updateDoc, setDoc, getDoc, onSnapshot 
} from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { 
  DailyReport, Client, ClientStatus, UserRole, 
  FollowUp, Target, DefaultTarget, User 
} from '../types';
import { 
  FileText, Send, BarChart3, Users, Star, 
  AlertTriangle, CheckCircle2, Target as TargetIcon, 
  TrendingUp, Clock, Search, Filter, ChevronDown, 
  ChevronUp, Edit3, Save, X, LayoutDashboard, ListChecks, Download
} from 'lucide-react';
import { analyzeDailyReport } from '../geminiService';

const Reports: React.FC = () => {
  const { user, effectiveRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'my-report' | 'manager-dashboard'>('my-report');
  
  // Sales State
  const [todayStats, setTodayStats] = useState<Partial<DailyReport>>({});
  const [todayTarget, setTodayTarget] = useState<Target | null>(null);
  const [checklist, setChecklist] = useState({
    chatsCleared: false,
    clientLevelsChecked: false,
    laptopStatusChecked: false,
    clientStatusUpdated: false
  });
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [myReports, setMyReports] = useState<DailyReport[]>([]);

  // Manager State
  const [allReports, setAllReports] = useState<DailyReport[]>([]);
  const [salesAgents, setSalesAgents] = useState<User[]>([]);
  const [defaultTargets, setDefaultTargets] = useState<Record<string, DefaultTarget>>({});
  const [managerTab, setManagerTab] = useState<'reports' | 'ranking' | 'targets'>('reports');
  
  // Filters
  const [filterAgent, setFilterAgent] = useState('all');
  const [filterDateStart, setFilterDateStart] = useState('');
  const [filterDateEnd, setFilterDateEnd] = useState('');
  const [searchName, setSearchName] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // Target Management
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [targetForm, setTargetForm] = useState({ newClients: 0, bookings: 0, followUps: 0, income: 0 });

  const exportToCSV = () => {
    if (filteredReports.length === 0) return;
    
    const headers = [
      "الموظف", "التاريخ", "وقت الإرسال", "عملاء جدد", "حجوزات", 
      "متابعات مكتملة", "نسبة الالتزام", "تأخيرات كبيرة", "ملاحظات"
    ];
    
    const rows = filteredReports.map(r => [
      r.userName,
      r.date,
      new Date(r.submittedAt).toLocaleTimeString('ar-EG'),
      r.newClients,
      r.booked,
      r.completedToday,
      `${r.punctualityRatio}%`,
      r.largeDelays,
      r.notes.replace(/,/g, ' ')
    ]);
    
    const csvContent = "\uFEFF" + [
      headers.join(","),
      ...rows.map(e => e.join(","))
    ].join("\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `reports_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isHighRole = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER || effectiveRole === UserRole.TEAM_LEADER;

  useEffect(() => {
    if (!user) return;
    if (isHighRole) {
      setActiveTab('manager-dashboard');
    }
  }, [effectiveRole, user]);

  useEffect(() => {
    if (!user) return;
    const init = async () => {
      setLoading(true);
      try {
        await Promise.all([
          calculateTodayStats(),
          fetchMyReports(),
          isHighRole ? fetchAllReports() : Promise.resolve(),
          isHighRole ? fetchAgents() : Promise.resolve(),
          isHighRole ? fetchDefaultTargets() : Promise.resolve()
        ]);
      } catch (err) {
        console.error("Reports Init Error:", err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [user, effectiveRole]);

  const calculateTodayStats = async () => {
    if (!user) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const todayStart = new Date().setHours(0,0,0,0);
    const todayEnd = new Date().setHours(23,59,59,999);
    const now = Date.now();

    // 1. Fetch Clients
    const clientsSnap = await getDocs(query(collection(db, 'clients'), where('salesAgentId', '==', user.uid)));
    const allMyClients = clientsSnap.docs.map(d => d.data() as Client);
    
    // 2. Fetch Today's FollowUps
    const followUpsSnap = await getDocs(query(collection(db, 'followups'), where('agentId', '==', user.uid), where('timestamp', '>=', todayStart)));
    const todayFollowUps = followUpsSnap.docs.map(d => d.data() as FollowUp);

    const targetId = `${user.uid}_${todayStr}`;
    const targetSnap = await getDoc(doc(db, 'targets', targetId));
    let target: Target | null = null;
    if (targetSnap.exists()) {
      target = { id: targetSnap.id, ...targetSnap.data() } as Target;
    } else {
      // Try default target
      const defTargetDoc = await getDoc(doc(db, 'defaultTargets', user.uid));
      if (defTargetDoc.exists()) {
        const data = defTargetDoc.data();
        target = { id: 'default', userId: user.uid, date: todayStr, newClients: data.newClients, bookings: data.bookings, followUps: data.followUps, income: data.income || 0 } as Target;
      }
    }
    setTodayTarget(target);

    // Calculate Stats
    const completedTodayScheduledForToday = todayFollowUps.filter(f => f.scheduledTime >= todayStart && f.scheduledTime <= todayEnd).length;
    const remainingScheduledToday = allMyClients.filter(c => c.nextFollowUpDate && c.nextFollowUpDate >= todayStart && c.nextFollowUpDate <= todayEnd).length;

    const bookedToday = allMyClients.filter(c => c.isBooked && c.bookingDate && c.bookingDate >= todayStart && c.bookingDate <= todayEnd);

    const stats: Partial<DailyReport> = {
      newClients: allMyClients.filter(c => c.createdAt >= todayStart).length,
      interested: allMyClients.filter(c => c.status === ClientStatus.INTERESTED).length,
      notInterested: allMyClients.filter(c => c.status === ClientStatus.NOT_INTERESTED).length,
      potential: allMyClients.filter(c => c.status === ClientStatus.POTENTIAL).length,
      booked: bookedToday.length,
      scheduledToday: completedTodayScheduledForToday + remainingScheduledToday,
      completedToday: todayFollowUps.length,
      overdueToday: allMyClients.filter(c => c.nextFollowUpDate && c.nextFollowUpDate < now).length,
      largeDelays: todayFollowUps.filter(f => f.delayStatus === 'large_delay').length,
      punctualityRatio: todayFollowUps.length > 0 
        ? Math.round((todayFollowUps.filter(f => f.delayStatus !== 'large_delay').length / todayFollowUps.length) * 100) 
        : 100,
      totalPaidToday: bookedToday.reduce((sum, c) => sum + (c.paidAmount || 0), 0),
      totalRemainingToday: bookedToday.reduce((sum, c) => sum + (c.remainingAmount || 0), 0)
    };
    setTodayStats(stats);
  };

  const fetchMyReports = async () => {
    if (!user) return;
    const q = query(collection(db, 'reports'), where('userId', '==', user.uid), orderBy('submittedAt', 'desc'), limit(10));
    const snap = await getDocs(q);
    setMyReports(snap.docs.map(d => ({ id: d.id, ...d.data() } as DailyReport)));
  };

  const fetchAllReports = async () => {
    const q = query(collection(db, 'reports'), orderBy('submittedAt', 'desc'), limit(100));
    const snap = await getDocs(q);
    setAllReports(snap.docs.map(d => ({ id: d.id, ...d.data() } as DailyReport)));
  };

  const fetchAgents = async () => {
    const q = query(collection(db, 'users'), where('role', 'in', [UserRole.SALES_AGENT, UserRole.TEAM_LEADER]));
    const snap = await getDocs(q);
    setSalesAgents(snap.docs.map(d => ({ uid: d.id, ...d.data() } as User)));
  };

  const fetchDefaultTargets = async () => {
    const snap = await getDocs(collection(db, 'defaultTargets'));
    const targets: Record<string, DefaultTarget> = {};
    snap.docs.forEach(d => {
      targets[d.id] = { id: d.id, ...d.data() } as DefaultTarget;
    });
    setDefaultTargets(targets);
  };

  const handleSubmitReport = async () => {
    if (!user || isSubmitting) return;
    
    const isChecklistComplete = Object.values(checklist).every(v => v);
    if (!isChecklistComplete) {
      alert("يرجى إكمال قائمة المراجعة اليومية أولاً");
      return;
    }

    setIsSubmitting(true);
    const todayStr = new Date().toISOString().split('T')[0];
    
    const reportData: Omit<DailyReport, 'id'> = {
      userId: user.uid,
      userName: user.name,
      date: todayStr,
      submittedAt: Date.now(),
      newClients: todayStats.newClients || 0,
      interested: todayStats.interested || 0,
      notInterested: todayStats.notInterested || 0,
      potential: todayStats.potential || 0,
      booked: todayStats.booked || 0,
      scheduledToday: todayStats.scheduledToday || 0,
      completedToday: todayStats.completedToday || 0,
      overdueToday: todayStats.overdueToday || 0,
      largeDelays: todayStats.largeDelays || 0,
      punctualityRatio: todayStats.punctualityRatio || 0,
      targetNewClients: todayTarget?.newClients || 0,
      targetBookings: todayTarget?.bookings || 0,
      targetFollowUps: todayTarget?.followUps || 0,
      targetIncome: todayTarget?.income || 0,
      totalPaidToday: todayStats.totalPaidToday || 0,
      totalRemainingToday: todayStats.totalRemainingToday || 0,
      checklist,
      notes
    };

    try {
      const aiAnalysis = await analyzeDailyReport(reportData as DailyReport);
      const finalData = { ...reportData, aiAnalysis };
      await addDoc(collection(db, 'reports'), finalData);
      await logActivity(user.uid, user.name, "إرسال تقرير يومي", "report", todayStr);
      alert("تم إرسال التقرير بنجاح");
      fetchMyReports();
    } catch (err) {
      console.error(err);
      alert("خطأ في إرسال التقرير");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditReport = async (report: DailyReport) => {
    if (!user) return;
    const newNotes = prompt("تعديل ملاحظات التقرير:", report.notes);
    if (newNotes === null) return;

    try {
      await updateDoc(doc(db, 'reports', report.id), {
        notes: newNotes,
        isEdited: true,
        editedBy: user.name,
        editedAt: Date.now()
      });
      await logActivity(user.uid, user.name, "تعديل تقرير يومي", report.id, report.date);
      fetchMyReports();
      if (isHighRole) fetchAllReports();
    } catch (err) {
      console.error(err);
    }
  };

  const [targetDate, setTargetDate] = useState(new Date().toISOString().split('T')[0]);

  const handleUpdateTarget = async (agentId: string, isDefault: boolean) => {
    if (!user) return;
    try {
      if (isDefault) {
        await setDoc(doc(db, 'defaultTargets', agentId), targetForm);
        await logActivity(user.uid, user.name, "تحديث التارجت الافتراضي", agentId, "Default Target");
      } else {
        const targetId = `${agentId}_${targetDate}`;
        await setDoc(doc(db, 'targets', targetId), {
          ...targetForm,
          userId: agentId,
          date: targetDate
        });
        await logActivity(user.uid, user.name, "تحديث تارجت يومي", agentId, targetDate);
      }
      setEditingTargetId(null);
      fetchDefaultTargets();
      alert("تم تحديث التارجت بنجاح");
    } catch (err) {
      console.error(err);
    }
  };

  const filteredReports = useMemo(() => {
    return allReports.filter(r => {
      const matchesAgent = filterAgent === 'all' || r.userId === filterAgent;
      const matchesDateStart = !filterDateStart || r.date >= filterDateStart;
      const matchesDateEnd = !filterDateEnd || r.date <= filterDateEnd;
      const matchesSearch = !searchName || r.userName.toLowerCase().includes(searchName.toLowerCase());
      return matchesAgent && matchesDateStart && matchesDateEnd && matchesSearch;
    });
  }, [allReports, filterAgent, filterDateStart, filterDateEnd, searchName]);

  const rankingData = useMemo(() => {
    const agentStats: Record<string, any> = {};
    
    allReports.forEach(r => {
      if (!agentStats[r.userId]) {
        agentStats[r.userId] = { 
          name: r.userName, 
          reportsCount: 0, 
          totalAchievement: 0, 
          totalPunctuality: 0, 
          totalDelays: 0,
          totalBookings: 0,
          totalNewClients: 0
        };
      }
      
      const achievement = (
        (r.newClients / (r.targetNewClients || 1)) + 
        (r.booked / (r.targetBookings || 1)) + 
        (r.completedToday / (r.targetFollowUps || 1)) +
        ((r.totalPaidToday || 0) / (r.targetIncome || 1))
      ) / 4 * 100;

      agentStats[r.userId].reportsCount++;
      agentStats[r.userId].totalAchievement += achievement;
      agentStats[r.userId].totalPunctuality += r.punctualityRatio;
      agentStats[r.userId].totalDelays += r.largeDelays;
      agentStats[r.userId].totalBookings += r.booked;
      agentStats[r.userId].totalNewClients += r.newClients;
      agentStats[r.userId].totalIncome = (agentStats[r.userId].totalIncome || 0) + (r.totalPaidToday || 0);
      agentStats[r.userId].totalRemaining = (agentStats[r.userId].totalRemaining || 0) + (r.totalRemainingToday || 0);
    });

    return Object.values(agentStats).map(s => ({
      ...s,
      avgAchievement: Math.round(s.totalAchievement / s.reportsCount),
      avgPunctuality: Math.round(s.totalPunctuality / s.reportsCount),
      conversionRatio: s.totalNewClients > 0 ? Math.round((s.totalBookings / s.totalNewClients) * 100) : 0
    })).sort((a, b) => b.avgAchievement - a.avgAchievement);
  }, [allReports]);

  if (loading) return <div className="text-center py-40 font-black animate-pulse text-primary-500">جاري تحميل البيانات الذكية...</div>;

  return (
    <div className="space-y-10 pb-20 max-w-7xl mx-auto animate-fade-in">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">نظام <span className="text-primary-500">التقارير</span> المتطور</h1>
          <p className="text-slate-500 font-bold mt-1">قياس الأداء، إدارة الأهداف، والتحليلات الذكية</p>
        </div>
        <div className="flex bg-white dark:bg-slate-900 p-1 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800">
          <button 
            onClick={() => setActiveTab('my-report')} 
            className={`px-6 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'my-report' ? 'bg-primary-500 text-white shadow-lg' : 'text-slate-400'}`}
          >
            <FileText size={14} /> تقريري اليومي
          </button>
          {isHighRole && (
            <button 
              onClick={() => setActiveTab('manager-dashboard')} 
              className={`px-6 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${activeTab === 'manager-dashboard' ? 'bg-primary-500 text-white shadow-lg' : 'text-slate-400'}`}
            >
              <LayoutDashboard size={14} /> لوحة تحكم الإدارة
            </button>
          )}
        </div>
      </header>

      {activeTab === 'my-report' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Left: Stats & Form */}
          <div className="lg:col-span-8 space-y-8">
            {/* Stats Cards */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="عملاء جدد" value={todayStats.newClients} icon={Users} color="text-blue-500" />
              <StatCard label="مهتمين" value={todayStats.interested} icon={Star} color="text-emerald-500" />
              <StatCard label="حجوزات" value={todayStats.booked} icon={CheckCircle2} color="text-amber-500" />
              <StatCard label="متابعات مكتملة" value={todayStats.completedToday} icon={TrendingUp} color="text-primary-500" />
            </section>

            {/* Financial Stats Today */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="bg-emerald-500 text-white p-8 rounded-[3rem] shadow-xl shadow-emerald-500/20 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase opacity-80 mb-1">إجمالي الدخل المحصل اليوم</p>
                    <p className="text-3xl font-black">{todayStats.totalPaidToday?.toLocaleString('ar-EG')} ج.م</p>
                  </div>
                  <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center"><TrendingUp size={32}/></div>
               </div>
               <div className="bg-amber-500 text-white p-8 rounded-[3rem] shadow-xl shadow-amber-500/20 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase opacity-80 mb-1">إجمالي المتبقي للاستكمال</p>
                    <p className="text-3xl font-black">{todayStats.totalRemainingToday?.toLocaleString('ar-EG')} ج.م</p>
                  </div>
                  <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center"><Clock size={32}/></div>
               </div>
            </section>

            {/* Detailed Stats Grid */}
            <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-xl grid grid-cols-2 md:grid-cols-3 gap-8">
              <MiniStat label="غير مهتم" value={todayStats.notInterested} />
              <MiniStat label="محتمل" value={todayStats.potential} />
              <MiniStat label="مجدولة اليوم" value={todayStats.scheduledToday} />
              <MiniStat label="متابعات متأخرة" value={todayStats.overdueToday} color="text-rose-500" />
              <MiniStat label="تأخيرات كبيرة" value={todayStats.largeDelays} color="text-rose-600" />
              <MiniStat label="نسبة الالتزام" value={`${todayStats.punctualityRatio}%`} color="text-primary-500" />
            </div>

            {/* Target Progress */}
            <section className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-xl space-y-6">
              <h2 className="text-xl font-black flex items-center gap-2"><TargetIcon className="text-primary-500" /> أهداف اليوم (التارجت)</h2>
              <div className="space-y-6">
                <TargetProgress label="العملاء الجدد" current={todayStats.newClients || 0} target={todayTarget?.newClients || 0} />
                <TargetProgress label="الحجوزات" current={todayStats.booked || 0} target={todayTarget?.bookings || 0} />
                <TargetProgress label="المتابعات المنفذة" current={todayStats.completedToday || 0} target={todayTarget?.followUps || 0} />
                <TargetProgress label="إجمالي الدخل (ج.م)" current={todayStats.totalPaidToday || 0} target={todayTarget?.income || 0} />
              </div>
            </section>

            {/* Checklist & Notes */}
            <section className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-xl space-y-8">
              <div className="space-y-4">
                <h2 className="text-xl font-black flex items-center gap-2"><ListChecks className="text-primary-500" /> قائمة المراجعة اليومية (إجبارية)</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <CheckItem label="تم تصفير جميع الشاتات" checked={checklist.chatsCleared} onChange={v => setChecklist({...checklist, chatsCleared: v})} />
                  <CheckItem label="تم التأكد من مستوى كل عميل" checked={checklist.clientLevelsChecked} onChange={v => setChecklist({...checklist, clientLevelsChecked: v})} />
                  <CheckItem label="تم التأكد من امتلاك العميل جهاز لاب توب" checked={checklist.laptopStatusChecked} onChange={v => setChecklist({...checklist, laptopStatusChecked: v})} />
                  <CheckItem label="تم تحديث حالة جميع العملاء" checked={checklist.clientStatusUpdated} onChange={v => setChecklist({...checklist, clientStatusUpdated: v})} />
                </div>
              </div>

              <div className="space-y-4">
                <h2 className="text-xl font-black flex items-center gap-2"><Edit3 size={20} className="text-primary-500" /> ملاحظات عن يوم العمل</h2>
                <textarea 
                  className="w-full p-6 bg-slate-50 dark:bg-slate-800 rounded-3xl border-none font-bold text-sm dark:text-white h-32 outline-none focus:ring-2 ring-primary-500/20" 
                  placeholder="اكتب ملاحظاتك هنا..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>

              <button 
                onClick={handleSubmitReport}
                disabled={isSubmitting}
                className="w-full py-6 bg-primary-500 text-white rounded-[2rem] font-black text-lg shadow-2xl hover:bg-primary-600 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
              >
                <Send size={24} /> {isSubmitting ? 'جاري الإرسال...' : 'إرسال التقرير النهائي'}
              </button>
            </section>
          </div>

          {/* Right: History */}
          <div className="lg:col-span-4 space-y-6">
            <h2 className="text-2xl font-black flex items-center gap-3"><Clock className="text-primary-500" /> تقاريري السابقة</h2>
            <div className="space-y-4">
              {myReports.map(report => (
                <ReportCard key={report.id} report={report} onEdit={() => handleEditReport(report)} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Manager Tabs */}
          <div className="flex gap-4 border-b border-slate-100 dark:border-slate-800 pb-4 overflow-x-auto no-scrollbar items-center justify-between w-full">
            <div className="flex gap-4">
              <ManagerTabBtn active={managerTab === 'reports'} onClick={() => setManagerTab('reports')} label="عرض التقارير" icon={FileText} />
              <ManagerTabBtn active={managerTab === 'ranking'} onClick={() => setManagerTab('ranking')} label="ترتيب الأداء" icon={TrendingUp} />
              <ManagerTabBtn active={managerTab === 'targets'} onClick={() => setManagerTab('targets')} label="إدارة التارجت" icon={TargetIcon} />
            </div>
            {managerTab === 'reports' && (
              <button 
                onClick={exportToCSV}
                className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white rounded-2xl text-[10px] font-black shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all shrink-0"
              >
                <Download size={14} /> تصدير البيانات (CSV)
              </button>
            )}
          </div>

          {managerTab === 'reports' && (
            <div className="space-y-6">
              {/* Filters */}
              <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-black text-sm flex items-center gap-2"><Filter size={16} /> فلاتر البحث</h3>
                  <button onClick={() => setIsFilterOpen(!isFilterOpen)} className="text-primary-500 text-[10px] font-black uppercase">
                    {isFilterOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                  </button>
                </div>
                {isFilterOpen && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-fade-in">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">الموظف</label>
                      <select className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs font-bold" value={filterAgent} onChange={e => setFilterAgent(e.target.value)}>
                        <option value="all">الكل</option>
                        {salesAgents.map(a => <option key={a.uid} value={a.uid}>{a.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">من تاريخ</label>
                      <input type="date" className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs font-bold" value={filterDateStart} onChange={e => setFilterDateStart(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">إلى تاريخ</label>
                      <input type="date" className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs font-bold" value={filterDateEnd} onChange={e => setFilterDateEnd(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase">بحث بالاسم</label>
                      <div className="relative">
                        <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="text" className="w-full p-3 pr-10 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs font-bold" placeholder="اسم الموظف..." value={searchName} onChange={e => setSearchName(e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredReports.map(report => (
                  <ReportCard key={report.id} report={report} onEdit={() => handleEditReport(report)} isManager />
                ))}
              </div>
            </div>
          )}

          {managerTab === 'ranking' && (
            <div className="bg-white dark:bg-slate-900 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-right">
                  <thead className="bg-slate-50 dark:bg-slate-800/50">
                    <tr>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">الترتيب</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">الموظف</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">نسبة الإنجاز</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">نسبة التحويل</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">الالتزام</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">الحجوزات</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">إجمالي المحصل</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">إجمالي المتبقي</th>
                      <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">التأخيرات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rankingData.map((agent, i) => (
                      <tr key={agent.name} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <td className="px-8 py-6">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-slate-700' : i === 2 ? 'bg-orange-400 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                            {i + 1}
                          </div>
                        </td>
                        <td className="px-8 py-6 font-black text-sm">{agent.name}</td>
                        <td className="px-8 py-6 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-lg font-black text-primary-500">{agent.avgAchievement}%</span>
                            <div className="w-20 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-primary-500 h-full" style={{ width: `${Math.min(agent.avgAchievement, 100)}%` }}></div>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6 text-center font-black text-blue-500">{agent.conversionRatio}%</td>
                        <td className="px-8 py-6 text-center font-black text-emerald-500">{agent.avgPunctuality}%</td>
                        <td className="px-8 py-6 text-center font-black text-amber-500">{agent.totalBookings}</td>
                        <td className="px-8 py-6 text-center font-black text-emerald-600">{agent.totalIncome?.toLocaleString('ar-EG')} ج.م</td>
                        <td className="px-8 py-6 text-center font-black text-amber-600">{agent.totalRemaining?.toLocaleString('ar-EG')} ج.م</td>
                        <td className="px-8 py-6 text-center font-black text-rose-500">{agent.totalDelays}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {managerTab === 'targets' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {salesAgents.map(agent => {
                const def = defaultTargets[agent.uid];
                const isEditing = editingTargetId === agent.uid;

                return (
                  <div key={agent.uid} className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-sm space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xl font-black">{agent.name}</h3>
                      <TargetIcon className="text-primary-500" size={20} />
                    </div>
                    
                    {isEditing ? (
                      <div className="space-y-4 animate-fade-in">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase mr-2">التاريخ (اتركه لليوم)</label>
                          <input type="date" className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs font-bold" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
                        </div>
                        <TargetInput label="عملاء جدد" value={targetForm.newClients} onChange={v => setTargetForm({...targetForm, newClients: v})} />
                        <TargetInput label="حجوزات" value={targetForm.bookings} onChange={v => setTargetForm({...targetForm, bookings: v})} />
                        <TargetInput label="متابعات" value={targetForm.followUps} onChange={v => setTargetForm({...targetForm, followUps: v})} />
                        <TargetInput label="الدخل المستهدف (ج.م)" value={targetForm.income} onChange={v => setTargetForm({...targetForm, income: v})} />
                        <div className="flex flex-col gap-2 pt-2">
                          <button onClick={() => handleUpdateTarget(agent.uid, false)} className="w-full py-3 bg-primary-500 text-white rounded-xl font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-primary-500/20"><Save size={14}/> حفظ لهذا اليوم فقط</button>
                          <button onClick={() => handleUpdateTarget(agent.uid, true)} className="w-full py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-black text-xs flex items-center justify-center gap-2">حفظ كهدف افتراضي يومي</button>
                          <button onClick={() => setEditingTargetId(null)} className="w-full py-3 text-slate-400 font-black text-[10px] uppercase">إلغاء</button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <TargetDisplay label="عملاء جدد" value={def?.newClients || 0} />
                        <TargetDisplay label="حجوزات" value={def?.bookings || 0} />
                        <TargetDisplay label="متابعات" value={def?.followUps || 0} />
                        <TargetDisplay label="الدخل المستهدف" value={`${(def?.income || 0).toLocaleString('ar-EG')} ج.م`} />
                        <button 
                          onClick={() => {
                            setEditingTargetId(agent.uid);
                            setTargetForm({ 
                              newClients: def?.newClients || 0, 
                              bookings: def?.bookings || 0, 
                              followUps: def?.followUps || 0,
                              income: def?.income || 0
                            });
                          }}
                          className="w-full py-3 bg-slate-50 dark:bg-slate-800 text-primary-500 rounded-xl font-black text-xs uppercase hover:bg-primary-500 hover:text-white transition-all"
                        >
                          تعديل التارجت الافتراضي
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, icon: Icon, color }: any) => (
  <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
    <div className={`w-12 h-12 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center ${color}`}><Icon size={24} /></div>
    <div>
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-xl font-black">{value || 0}</p>
    </div>
  </div>
);

const MiniStat = ({ label, value, color }: any) => (
  <div className="text-center">
    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
    <p className={`text-lg font-black ${color || 'text-slate-900 dark:text-white'}`}>{value || 0}</p>
  </div>
);

const TargetProgress = ({ label, current, target }: { label: string, current: number, target: number }) => {
  const ratio = target > 0 ? Math.round((current / target) * 100) : 100;
  const status = ratio < 50 ? "أقل من المطلوب" : ratio < 100 ? "على المسار الصحيح" : "تم تحقيق الهدف";
  const statusColor = ratio < 50 ? "text-rose-500" : ratio < 100 ? "text-blue-500" : "text-emerald-500";
  const barColor = ratio < 50 ? "bg-rose-500" : ratio < 100 ? "bg-blue-500" : "bg-emerald-500";

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-end">
        <div>
          <p className="text-xs font-black">{label}</p>
          <p className={`text-[9px] font-black ${statusColor}`}>{status}</p>
        </div>
        <div className="text-left">
          <span className="text-lg font-black">{current}</span>
          <span className="text-[10px] font-black text-slate-400"> / {target}</span>
        </div>
      </div>
      <div className="w-full bg-slate-100 dark:bg-slate-800 h-3 rounded-full overflow-hidden">
        <div className={`${barColor} h-full transition-all duration-1000`} style={{ width: `${Math.min(ratio, 100)}%` }}></div>
      </div>
    </div>
  );
};

const CheckItem = ({ label, checked, onChange }: { label: string, checked: boolean, onChange: (v: boolean) => void }) => (
  <label className={`flex items-center gap-3 p-4 rounded-2xl cursor-pointer transition-all border ${checked ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400' : 'bg-slate-50 dark:bg-slate-800 border-transparent text-slate-500'}`}>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-5 h-5 accent-emerald-500" />
    <span className="text-[11px] font-black">{label}</span>
  </label>
);

const ReportCard: React.FC<{ report: DailyReport, onEdit: () => void, isManager?: boolean }> = ({ report, onEdit, isManager }) => {
  const achievement = Math.round((
    (report.newClients / (report.targetNewClients || 1)) + 
    (report.booked / (report.targetBookings || 1)) + 
    (report.completedToday / (report.targetFollowUps || 1)) +
    ((report.totalPaidToday || 0) / (report.targetIncome || 1))
  ) / 4 * 100);

  return (
    <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm space-y-4 relative overflow-hidden">
      {report.isEdited && (
        <div className="absolute top-0 left-0 bg-blue-500 text-white px-4 py-1 rounded-br-2xl text-[8px] font-black flex items-center gap-1">
          <Edit3 size={10} /> تم التعديل بواسطة: {report.editedBy}
        </div>
      )}
      <div className="flex justify-between items-start pt-2">
        <div>
          <h4 className="font-black text-slate-900 dark:text-white">{isManager ? report.userName : report.date}</h4>
          <p className="text-[9px] text-slate-400 font-black uppercase">إرسال: {new Date(report.submittedAt).toLocaleTimeString('ar-EG')}</p>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-lg font-black text-primary-500">{achievement}%</span>
          <span className="text-[8px] font-black text-slate-400 uppercase">الإنجاز الكلي</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MiniReportStat label="جديد" value={report.newClients} target={report.targetNewClients} />
        <MiniReportStat label="حجز" value={report.booked} target={report.targetBookings} />
        <MiniReportStat label="متابعة" value={report.completedToday} target={report.targetFollowUps} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 bg-emerald-50 dark:bg-emerald-500/5 rounded-xl text-center">
          <p className="text-[8px] font-black text-emerald-600 uppercase">المحصل</p>
          <p className="text-xs font-black text-emerald-700">{report.totalPaidToday?.toLocaleString('ar-EG')} ج.م</p>
        </div>
        <div className="p-3 bg-amber-50 dark:bg-amber-500/5 rounded-xl text-center">
          <p className="text-[8px] font-black text-amber-600 uppercase">المتبقي</p>
          <p className="text-xs font-black text-amber-700">{report.totalRemainingToday?.toLocaleString('ar-EG')} ج.م</p>
        </div>
      </div>

      {report.notes && (
        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
          <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 line-clamp-2">{report.notes}</p>
        </div>
      )}

      {report.aiAnalysis && (
        <div className="p-3 bg-primary-50 dark:bg-primary-500/5 rounded-xl border-r-4 border-primary-500">
          <p className="text-[10px] font-bold text-primary-700 dark:text-primary-400 italic">"{report.aiAnalysis}"</p>
        </div>
      )}

      <button onClick={onEdit} className="w-full py-2 text-[10px] font-black text-slate-400 hover:text-primary-500 transition-colors uppercase border-t border-slate-50 dark:border-slate-800 pt-3">تعديل الملاحظات</button>
    </div>
  );
};

const MiniReportStat = ({ label, value, target }: any) => (
  <div className="text-center p-2 bg-slate-50 dark:bg-slate-800 rounded-xl">
    <p className="text-[8px] font-black text-slate-400 uppercase">{label}</p>
    <p className="text-xs font-black">{value}<span className="text-[8px] opacity-40">/{target}</span></p>
  </div>
);

const ManagerTabBtn = ({ active, onClick, label, icon: Icon }: any) => (
  <button onClick={onClick} className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-black transition-all shrink-0 ${active ? 'bg-primary-500 text-white shadow-lg' : 'bg-white dark:bg-slate-900 text-slate-400 border border-slate-100 dark:border-slate-800'}`}>
    <Icon size={14} /> {label}
  </button>
);

const TargetInput = ({ label, value, onChange }: any) => (
  <div className="space-y-1">
    <label className="text-[10px] font-black text-slate-400 uppercase mr-2">{label}</label>
    <input type="number" className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-xs outline-none" value={value} onChange={e => onChange(parseInt(e.target.value) || 0)} />
  </div>
);

const TargetDisplay = ({ label, value }: any) => (
  <div className="flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl">
    <span className="text-[10px] font-black text-slate-400 uppercase">{label}</span>
    <span className="text-sm font-black">{value}</span>
  </div>
);

export default Reports;
