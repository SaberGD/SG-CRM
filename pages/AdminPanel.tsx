
import React, { useState, useEffect, useMemo } from 'react';
// Added missing import for useNavigate
import { useNavigate } from 'react-router-dom';
// Added limit to firebase/firestore imports
import { collection, query, onSnapshot, doc, updateDoc, deleteDoc, orderBy, getDocs, where, limit } from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { User, UserRole, Client, FollowUp, ActivityLog } from '../types';
import { 
  ShieldCheck, UserCog, Mail, ShieldAlert, Trash2, Search, Edit3, 
  X, Check, Users, Calendar, BarChart, Phone, Eye, ArrowLeft,
  FileText, Activity, AlertCircle, UserX, UserCheck, ArrowRightLeft,
  PauseCircle, CheckCircle2, RefreshCw, Sparkles, UserMinus
} from 'lucide-react';
import FloatingPanel from '../components/FloatingPanel';

const AdminPanel: React.FC = () => {
  const { user } = useAuth();
  // Initialized navigate function using useNavigate hook
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [userStatusFilter, setUserStatusFilter] = useState<'active' | 'deactivated' | 'all'>('active');
  
  // Modal States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userLogs, setUserLogs] = useState<ActivityLog[]>([]);
  
  const [editFormData, setEditFormData] = useState({ name: '', email: '', role: UserRole.SALES_AGENT });

  // Deactivation & Reassignment Modal States
  const [isDeactivateModalOpen, setIsDeactivateModalOpen] = useState(false);
  const [deactivatingUser, setDeactivatingUser] = useState<User | null>(null);
  const [transferMode, setTransferMode] = useState<'distribute' | 'single' | 'keep'>('distribute');
  const [singleTargetAgentId, setSingleTargetAgentId] = useState<string>('');
  const [isProcessingTransfer, setIsProcessingTransfer] = useState(false);

  // Standalone Transfer Modal States
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferSourceUser, setTransferSourceUser] = useState<User | null>(null);

  useEffect(() => {
    // جلب كافة المستخدمين بدون أي فلترة أو ترتيب من جهة السيرفر لضمان ظهور الجميع
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      const allUsers = snap.docs.map(d => ({ uid: d.id, ...d.data() } as User));
      
      // الترتيب برمجياً هنا لضمان عدم اختفاء أي مستخدم
      const sorted = allUsers.sort((a, b) => {
        if (a.uid === user?.uid) return -1;
        if (b.uid === user?.uid) return 1;
        const nameA = a.name || a.email || '';
        const nameB = b.name || b.email || '';
        return nameA.localeCompare(nameB);
      });
      
      setUsers(sorted);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching users:", err);
      setLoading(false);
    });

    const unsubClients = onSnapshot(collection(db, 'clients'), (snap) => {
      setClients(snap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
    }, (err) => {
      console.error("AdminPanel Clients Snapshot Error:", err);
    });

    return () => {
      unsubUsers();
      unsubClients();
    };
  }, [user?.uid]);

  const activeSalesAgents = useMemo(() => {
    return users.filter(u => !u.isDeactivated && u.uid !== deactivatingUser?.uid && u.uid !== transferSourceUser?.uid);
  }, [users, deactivatingUser, transferSourceUser]);

  const userStats = useMemo(() => {
    const stats: Record<string, { totalClients: number, pendingFollowups: number }> = {};
    users.forEach(u => {
      const userClients = clients.filter(c => c.salesAgentId === u.uid);
      stats[u.uid] = {
        totalClients: userClients.length,
        pendingFollowups: userClients.filter(c => c.nextFollowUpDate && c.nextFollowUpDate > 0).length
      };
    });
    return stats;
  }, [users, clients]);

  const handleEditClick = (u: User) => {
    setSelectedUser(u);
    setEditFormData({ name: u.name || '', email: u.email, role: u.role });
    setIsEditModalOpen(true);
  };

  const handleViewDetails = async (u: User) => {
    setSelectedUser(u);
    setIsDetailsModalOpen(true);
    
    try {
      const q = query(collection(db, 'logs'), where('userId', '==', u.uid), orderBy('timestamp', 'desc'), limit(15));
      const snap = await getDocs(q);
      setUserLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ActivityLog)));
    } catch (err) {
      console.error("Error fetching logs:", err);
      setUserLogs([]);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !user) return;

    try {
      const userRef = doc(db, 'users', selectedUser.uid);
      await updateDoc(userRef, {
        name: editFormData.name,
        email: editFormData.email,
        role: editFormData.role
      });

      await logActivity(
        user.uid, 
        user.name, 
        `تعديل بيانات الموظف [${selectedUser.name || 'غير معروف'}]`, 
        selectedUser.uid, 
        editFormData.name
      );

      setIsEditModalOpen(false);
    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء التحديث");
    }
  };

  // Trigger Deactivation Flow
  const handleOpenDeactivateModal = (u: User) => {
    if (u.uid === user?.uid) return alert("لا يمكنك إيقاف حسابك الخاص!");
    setDeactivatingUser(u);
    setTransferMode('distribute');
    const available = users.filter(a => !a.isDeactivated && a.uid !== u.uid);
    if (available.length > 0) {
      setSingleTargetAgentId(available[0].uid);
    }
    setIsDeactivateModalOpen(true);
  };

  // Confirm Deactivation & Reassign Clients
  const handleConfirmDeactivate = async () => {
    if (!deactivatingUser || !user) return;
    setIsProcessingTransfer(true);

    try {
      const userClients = clients.filter(c => c.salesAgentId === deactivatingUser.uid);
      const availableAgents = activeSalesAgents.filter(a => a.uid !== deactivatingUser.uid);

      if (userClients.length > 0 && transferMode !== 'keep') {
        if (transferMode === 'single') {
          const targetAgent = users.find(a => a.uid === singleTargetAgentId);
          if (!targetAgent) {
            alert("يرجى اختيار المسؤول المحول إليه العملاء!");
            setIsProcessingTransfer(false);
            return;
          }

          for (const client of userClients) {
            await updateDoc(doc(db, 'clients', client.id), {
              salesAgentId: targetAgent.uid,
              salesAgentName: targetAgent.name || targetAgent.email
            });
          }
        } else if (transferMode === 'distribute') {
          if (availableAgents.length === 0) {
            alert("لا يوجد مسؤولي مبيعات مفعلين آخرين لتوزيع العملاء عليهم!");
            setIsProcessingTransfer(false);
            return;
          }

          for (let i = 0; i < userClients.length; i++) {
            const client = userClients[i];
            const targetAgent = availableAgents[i % availableAgents.length];
            await updateDoc(doc(db, 'clients', client.id), {
              salesAgentId: targetAgent.uid,
              salesAgentName: targetAgent.name || targetAgent.email
            });
          }
        }
      }

      // Mark user as deactivated
      await updateDoc(doc(db, 'users', deactivatingUser.uid), {
        isDeactivated: true,
        deactivatedAt: Date.now()
      });

      await logActivity(
        user.uid,
        user.name,
        `إيقاف الموظف [${deactivatingUser.name || deactivatingUser.email}] عن العمل وتحويل (${userClients.length}) عميل`,
        deactivatingUser.uid,
        deactivatingUser.name || 'غير معروف'
      );

      alert(`تم إيقاف الموظف [${deactivatingUser.name}] بنجاح وتحويل عُملائه!`);
      setIsDeactivateModalOpen(false);
      setDeactivatingUser(null);
    } catch (err) {
      console.error("Error deactivating user:", err);
      alert("حدث خطأ أثناء عملية إيقاف الموظف وتحويل العملاء.");
    } finally {
      setIsProcessingTransfer(false);
    }
  };

  // Reactivate User
  const handleReactivateUser = async (u: User) => {
    if (!user) return;
    const confirm = window.confirm(`هل أنت تأكد من إعادة تفعيل حساب الموظف [${u.name || u.email}]؟`);
    if (!confirm) return;

    try {
      await updateDoc(doc(db, 'users', u.uid), {
        isDeactivated: false
      });

      await logActivity(
        user.uid,
        user.name,
        `إعادة تفعيل حساب الموظف [${u.name || u.email}]`,
        u.uid,
        u.name || 'غير معروف'
      );

      alert(`تم إعادة تفعيل حساب الموظف [${u.name}] بنجاح.`);
    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء إعادة تفعيل الحساب.");
    }
  };

  // Standalone Client Transfer
  const handleOpenTransferModal = (u: User) => {
    setTransferSourceUser(u);
    setTransferMode('distribute');
    const available = users.filter(a => !a.isDeactivated && a.uid !== u.uid);
    if (available.length > 0) {
      setSingleTargetAgentId(available[0].uid);
    }
    setIsTransferModalOpen(true);
  };

  const handleConfirmStandaloneTransfer = async () => {
    if (!transferSourceUser || !user) return;
    setIsProcessingTransfer(true);

    try {
      const userClients = clients.filter(c => c.salesAgentId === transferSourceUser.uid);
      const availableAgents = activeSalesAgents.filter(a => a.uid !== transferSourceUser.uid);

      if (userClients.length === 0) {
        alert("هذا الموظف لا يمتلك أي عملاء لتحويلهم حالياً!");
        setIsProcessingTransfer(false);
        return;
      }

      if (transferMode === 'single') {
        const targetAgent = users.find(a => a.uid === singleTargetAgentId);
        if (!targetAgent) {
          alert("يرجى اختيار المسؤول المحول إليه!");
          setIsProcessingTransfer(false);
          return;
        }

        for (const client of userClients) {
          await updateDoc(doc(db, 'clients', client.id), {
            salesAgentId: targetAgent.uid,
            salesAgentName: targetAgent.name || targetAgent.email
          });
        }
      } else if (transferMode === 'distribute') {
        if (availableAgents.length === 0) {
          alert("لا يوجد مسؤولي مبيعات مفعلين آخرين لتوزيع العملاء عليهم!");
          setIsProcessingTransfer(false);
          return;
        }

        for (let i = 0; i < userClients.length; i++) {
          const client = userClients[i];
          const targetAgent = availableAgents[i % availableAgents.length];
          await updateDoc(doc(db, 'clients', client.id), {
            salesAgentId: targetAgent.uid,
            salesAgentName: targetAgent.name || targetAgent.email
          });
        }
      }

      await logActivity(
        user.uid,
        user.name,
        `تحويل (${userClients.length}) عميل من الموظف [${transferSourceUser.name}]`,
        transferSourceUser.uid,
        transferSourceUser.name || 'غير معروف'
      );

      alert(`تم تحويل (${userClients.length}) عميل بنجاح!`);
      setIsTransferModalOpen(false);
      setTransferSourceUser(null);
    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء تحويل العملاء.");
    } finally {
      setIsProcessingTransfer(false);
    }
  };

  const handleDeleteUser = async (u: User) => {
    if (!user) return;
    if (u.uid === user.uid) return alert("لا يمكنك حذف حسابك الخاص من هنا!");
    
    const confirmation = prompt(`لحذف المستخدم [${u.name || u.email}] نهائياً، يرجى كتابة كلمة 'delete' للتأكيد:`);
    if (confirmation === 'delete') {
      try {
        await deleteDoc(doc(db, 'users', u.uid));
        await logActivity(user.uid, user.name, `حذف الموظف [${u.name || u.email}]`, u.uid, u.name || 'غير معروف');
        alert("تم حذف المستخدم بنجاح");
      } catch (err) {
        console.error(err);
        alert("حدث خطأ أثناء الحذف");
      }
    } else if (confirmation !== null) {
      alert("كلمة التأكيد غير صحيحة، لم يتم الحذف.");
    }
  };

  const activeCount = users.filter(u => !u.isDeactivated).length;
  const deactivatedCount = users.filter(u => u.isDeactivated).length;

  const filteredUsers = users.filter(u => {
    const matchesSearch = (u.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (u.email || '').toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;

    if (userStatusFilter === 'active') return !u.isDeactivated;
    if (userStatusFilter === 'deactivated') return u.isDeactivated === true;
    return true;
  });

  if (user?.role !== UserRole.ADMIN) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4 animate-fade-in text-center p-6">
        <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-3xl flex items-center justify-center mb-4 shadow-inner">
          <ShieldAlert size={48} />
        </div>
        <h2 className="text-2xl font-black text-slate-950 dark:text-white uppercase tracking-tighter">دخول غير مصرح</h2>
        <p className="text-slate-500 font-bold max-w-sm">هذه الصفحة تحتوي على بيانات حساسة ومخصصة للمديرين العامين فقط.</p>
        <button onClick={() => navigate('/')} className="mt-6 px-10 py-4 bg-primary-500 text-white rounded-2xl font-black text-xs uppercase shadow-xl">العودة للرئيسية</button>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter flex items-center gap-4">
            <ShieldCheck className="text-primary-500" size={40} /> إدارة <span className="text-primary-500">فريق العمل</span>
          </h1>
          <p className="text-slate-500 font-bold mt-1">عرض والتحكم في كافة مستخدمي وصلاحيات النظام، وإيقاف الموظفين وتحويل عُملائهم</p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="بحث عن اسم أو بريد..." 
            className="w-full pr-12 pl-4 py-4 bg-white dark:bg-slate-900 rounded-2xl outline-none font-bold text-sm border border-slate-100 dark:border-slate-800 shadow-sm focus:border-primary-500/50 transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </header>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <QuickSummary icon={Users} label="إجمالي الفريق" value={users.length} color="bg-primary-500" />
        <QuickSummary icon={UserCheck} label="الموظفين الشغالين" value={activeCount} color="bg-emerald-500" />
        <QuickSummary icon={UserX} label="المتوقفين عن العمل" value={deactivatedCount} color="bg-rose-500" />
        <QuickSummary icon={UserCog} label="المسؤولين والمشرفين" value={users.filter(u => u.role !== UserRole.SALES_AGENT && !u.isDeactivated).length} color="bg-amber-500" />
      </div>

      {/* Table & Filtering Tabs */}
      <div className="bg-white dark:bg-slate-900 rounded-[3rem] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden space-y-4 p-6">
        
        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUserStatusFilter('active')}
              className={`px-5 py-2.5 rounded-2xl font-black text-xs transition flex items-center gap-2 ${
                userStatusFilter === 'active'
                  ? 'bg-emerald-500 text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <UserCheck size={16} />
              <span>الموظفين المفعلين ({activeCount})</span>
            </button>

            <button
              onClick={() => setUserStatusFilter('deactivated')}
              className={`px-5 py-2.5 rounded-2xl font-black text-xs transition flex items-center gap-2 ${
                userStatusFilter === 'deactivated'
                  ? 'bg-rose-500 text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <UserX size={16} />
              <span>المتوقفين عن العمل ({deactivatedCount})</span>
            </button>

            <button
              onClick={() => setUserStatusFilter('all')}
              className={`px-5 py-2.5 rounded-2xl font-black text-xs transition ${
                userStatusFilter === 'all'
                  ? 'bg-primary-500 text-white shadow-md'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              الكل ({users.length})
            </button>
          </div>

          <p className="text-xs font-bold text-slate-400">
            {userStatusFilter === 'active' && 'يتم عرض الموظفين المتواجدين بالشغل حالياً والظاهرين في القوائم'}
            {userStatusFilter === 'deactivated' && 'هؤلاء الموظفين تم إيقافهم ومخفيين تلقائياً من كافة قوائم السيلز والنظام'}
            {userStatusFilter === 'all' && 'عرض كافة سجلات الموظفين الحالية والسابقة'}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">الموظف</th>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">الرتبة والحالة</th>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">العملاء</th>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">تاريخ الانضمام</th>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">الإجراءات والتحويل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={5} className="py-20 text-center animate-pulse font-black text-slate-400 uppercase italic tracking-widest">جاري تحميل البيانات...</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan={5} className="py-20 text-center text-slate-400 font-bold italic">لا توجد نتائج مطابقة لبحثك</td></tr>
              ) : filteredUsers.map((u) => {
                const clientCount = userStats[u.uid]?.totalClients || 0;

                return (
                  <tr key={u.uid} className={`hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-all group ${
                    u.isDeactivated ? 'bg-rose-50/20 dark:bg-rose-950/10 opacity-75' : 
                    u.uid === user?.uid ? 'bg-primary-50/20 dark:bg-primary-500/5' : ''
                  }`}>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-4">
                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black transition-transform shadow-inner uppercase ${
                          u.isDeactivated ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-500' : 'bg-slate-100 dark:bg-slate-800 text-primary-500 group-hover:scale-110'
                        }`}>
                          {(u.name || u.email || '?')[0]}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                             <span className="font-black text-sm text-slate-900 dark:text-white block">{u.name || (u.email ? u.email.split('@')[0] : 'بدون اسم')}</span>
                             {u.uid === user?.uid && <span className="px-2 py-0.5 bg-primary-500 text-white text-[8px] font-black rounded-md uppercase tracking-tighter">أنت</span>}
                             {u.isDeactivated && <span className="px-2 py-0.5 bg-rose-500 text-white text-[8px] font-black rounded-md uppercase tracking-tighter">متوقف</span>}
                          </div>
                          <span className="text-[10px] text-slate-400 font-bold">{u.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                          u.role === UserRole.ADMIN ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10' :
                          u.role === UserRole.SUPERVISOR ? 'bg-purple-50 text-purple-600 dark:bg-purple-500/10' :
                          u.role === UserRole.MANAGER ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10' :
                          u.role === UserRole.TEAM_LEADER ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10' :
                          'bg-slate-100 text-slate-600 dark:bg-slate-800'
                        }`}>
                          {u.role}
                        </span>

                        {u.isDeactivated ? (
                          <span className="px-2.5 py-0.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[10px] font-black rounded-lg flex items-center gap-1 border border-rose-500/20">
                            <PauseCircle size={12} /> متوقف عن العمل
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black rounded-lg flex items-center gap-1 border border-emerald-500/20">
                            <CheckCircle2 size={12} /> نشط بالشغل
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-5 text-center">
                      <div className="inline-flex flex-col items-center">
                        <span className={`text-sm font-black ${clientCount > 0 ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>{clientCount}</span>
                        <span className="text-[8px] font-black text-slate-400 uppercase">عميل مسجل</span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-center">
                      <span className="text-[10px] font-bold text-slate-500">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString('ar-EG') : '--/--/----'}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex justify-center items-center gap-2">
                        
                        {/* Standalone Transfer Button */}
                        {clientCount > 0 && (
                          <button
                            onClick={() => handleOpenTransferModal(u)}
                            className="px-3 py-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl hover:bg-indigo-100 transition font-black text-[11px] flex items-center gap-1 border border-indigo-200 dark:border-indigo-800"
                            title="تحويل عُملائه إلى سيلز آخرين"
                          >
                            <ArrowRightLeft size={14} />
                            <span>تحويل العملاء</span>
                          </button>
                        )}

                        {/* Deactivate OR Reactivate Button */}
                        {u.uid !== user?.uid && (
                          u.isDeactivated ? (
                            <button
                              onClick={() => handleReactivateUser(u)}
                              className="px-3 py-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl hover:bg-emerald-100 transition font-black text-[11px] flex items-center gap-1 border border-emerald-200 dark:border-emerald-800"
                              title="إعادة تفعيل الموظف وإعادته للشغل"
                            >
                              <UserCheck size={14} />
                              <span>إعادة تفعيل</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenDeactivateModal(u)}
                              className="px-3 py-2 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-xl hover:bg-rose-100 transition font-black text-[11px] flex items-center gap-1 border border-rose-200 dark:border-rose-800"
                              title="إيقاف الموظف عن العمل وتوزيع عملاءه"
                            >
                              <UserX size={14} />
                              <span>إيقاف العمل</span>
                            </button>
                          )
                        )}

                        <button onClick={() => handleViewDetails(u)} className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-xl hover:text-primary-500 transition-all" title="التفاصيل والنشاط"><Eye size={16} /></button>
                        <button onClick={() => handleEditClick(u)} className="p-2.5 bg-primary-50 text-primary-500 rounded-xl hover:scale-105 transition-all dark:bg-primary-500/10" title="تعديل الاسم أو الرتبة"><UserCog size={16} /></button>
                        {u.uid !== user?.uid && (
                          <button onClick={() => handleDeleteUser(u)} className="p-2.5 bg-slate-100 text-slate-400 hover:text-rose-500 rounded-xl hover:scale-105 transition-all dark:bg-slate-800" title="حذف الحساب نهائياً"><Trash2 size={16} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* DEACTIVATION & CLIENT REASSIGNMENT MODAL */}
      {isDeactivateModalOpen && deactivatingUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-7 max-w-xl w-full border border-slate-200 dark:border-slate-800 space-y-6 shadow-2xl relative">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center font-black">
                  <UserX size={24} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">إيقاف الموظف وتحويل العُلاء</h3>
                  <p className="text-xs font-bold text-slate-400">إيقاف حساب [{deactivatingUser.name}] وتحويل عملاءه للسيلز المفعلين</p>
                </div>
              </div>
              <button 
                onClick={() => setIsDeactivateModalOpen(false)}
                className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-xl hover:bg-slate-200 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Target Summary */}
            <div className="p-4 bg-rose-50/50 dark:bg-rose-950/20 rounded-2xl border border-rose-200 dark:border-rose-800/40 flex items-center justify-between text-xs font-black">
              <div>
                <p className="text-rose-900 dark:text-rose-200 font-black">{deactivatingUser.name} ({deactivatingUser.email})</p>
                <p className="text-slate-500 text-[11px] font-bold">الرتبة: {deactivatingUser.role}</p>
              </div>
              <div className="text-center bg-white dark:bg-slate-900 px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-800">
                <span className="text-base font-black text-rose-600 block">{userStats[deactivatingUser.uid]?.totalClients || 0}</span>
                <span className="text-[9px] font-bold text-slate-400 uppercase">عميل بحاجة تحويل</span>
              </div>
            </div>

            {/* Reassignment Options */}
            {(userStats[deactivatingUser.uid]?.totalClients || 0) > 0 ? (
              <div className="space-y-4">
                <label className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <ArrowRightLeft size={16} className="text-indigo-500" />
                  <span>اختر طريقة تحويل العملاء الـ ({userStats[deactivatingUser.uid]?.totalClients}):</span>
                </label>

                {/* Option 1: Distribute evenly */}
                <div 
                  onClick={() => setTransferMode('distribute')}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                    transferMode === 'distribute' 
                      ? 'bg-primary-50/70 dark:bg-primary-500/10 border-primary-500 text-slate-900 dark:text-white' 
                      : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-500'
                  }`}
                >
                  <input type="radio" checked={transferMode === 'distribute'} onChange={() => setTransferMode('distribute')} className="mt-1" />
                  <div>
                    <p className="text-xs font-black">توزيع العملاء بالتساوي على جميع السيلز المفعلين ({activeSalesAgents.length} سيلز)</p>
                    <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                      سيتم توزيع الـ ({userStats[deactivatingUser.uid]?.totalClients}) عميل بالتساوي بأسلوب حلقة التوزيع العدل
                    </p>
                  </div>
                </div>

                {/* Option 2: Single Target Agent */}
                <div 
                  onClick={() => setTransferMode('single')}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer space-y-3 ${
                    transferMode === 'single' 
                      ? 'bg-primary-50/70 dark:bg-primary-500/10 border-primary-500 text-slate-900 dark:text-white' 
                      : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-500'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input type="radio" checked={transferMode === 'single'} onChange={() => setTransferMode('single')} className="mt-1" />
                    <div>
                      <p className="text-xs font-black">تحويل جميع العملاء إلى مسئول مبيعات محدد</p>
                      <p className="text-[11px] font-bold text-slate-400 mt-0.5">نقل ملائكة الكشوف بالكامل لموظف آخر واحد</p>
                    </div>
                  </div>

                  {transferMode === 'single' && (
                    <select
                      value={singleTargetAgentId}
                      onChange={(e) => setSingleTargetAgentId(e.target.value)}
                      className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-primary-500"
                    >
                      {activeSalesAgents.map(a => (
                        <option key={a.uid} value={a.uid}>{a.name} ({a.email}) - {a.role}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Option 3: Keep Unassigned */}
                <div 
                  onClick={() => setTransferMode('keep')}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                    transferMode === 'keep' 
                      ? 'bg-amber-50/70 dark:bg-amber-500/10 border-amber-500 text-slate-900 dark:text-white' 
                      : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-500'
                  }`}
                >
                  <input type="radio" checked={transferMode === 'keep'} onChange={() => setTransferMode('keep')} className="mt-1" />
                  <div>
                    <p className="text-xs font-black">الإبقاء على العملاء كما هم مؤقتاً بدون تحويل</p>
                    <p className="text-[11px] font-bold text-slate-400 mt-0.5">سيبقى الموظف مسجلاً كمسؤول عن العملاء ولكن حسابه متوقف</p>
                  </div>
                </div>

              </div>
            ) : (
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 rounded-2xl text-xs font-black text-center border border-emerald-200 dark:border-emerald-800">
                هذا الموظف لا يمتلك أي عملاء مسجلين حالياً. سيتم إيقاف حسابه مباشرة.
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setIsDeactivateModalOpen(false)}
                disabled={isProcessingTransfer}
                className="px-5 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl text-xs font-black hover:bg-slate-200 transition"
              >
                إلغاء
              </button>

              <button
                onClick={handleConfirmDeactivate}
                disabled={isProcessingTransfer}
                className="px-6 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-black text-xs transition flex items-center gap-2 shadow-lg disabled:opacity-50"
              >
                {isProcessingTransfer ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>جاري التحويل والإيقاف...</span>
                  </>
                ) : (
                  <>
                    <UserX size={16} />
                    <span>تأكيد إيقاف الموظف وتحويل العملاء</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* STANDALONE CLIENT TRANSFER MODAL */}
      {isTransferModalOpen && transferSourceUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-7 max-w-xl w-full border border-slate-200 dark:border-slate-800 space-y-6 shadow-2xl relative">
            
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center font-black">
                  <ArrowRightLeft size={24} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">تحويل عملاء [{transferSourceUser.name}]</h3>
                  <p className="text-xs font-bold text-slate-400">نقل عملاء الموظف إلى سيلز أخرين دون إيقاف حسابه</p>
                </div>
              </div>
              <button 
                onClick={() => setIsTransferModalOpen(false)}
                className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-xl hover:bg-slate-200 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-2xl border border-indigo-200 dark:border-indigo-800/40 flex items-center justify-between text-xs font-black">
              <div>
                <p className="text-indigo-900 dark:text-indigo-200 font-black">{transferSourceUser.name}</p>
                <p className="text-slate-500 text-[11px] font-bold">{transferSourceUser.email}</p>
              </div>
              <div className="text-center bg-white dark:bg-slate-900 px-4 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800">
                <span className="text-base font-black text-indigo-600 block">{userStats[transferSourceUser.uid]?.totalClients || 0}</span>
                <span className="text-[9px] font-bold text-slate-400 uppercase">عميل للتحويل</span>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-2">
                <ArrowRightLeft size={16} className="text-indigo-500" />
                <span>اختر طريقة التحويل:</span>
              </label>

              <div 
                onClick={() => setTransferMode('distribute')}
                className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                  transferMode === 'distribute' 
                    ? 'bg-primary-50/70 dark:bg-primary-500/10 border-primary-500 text-slate-900 dark:text-white' 
                    : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-500'
                }`}
              >
                <input type="radio" checked={transferMode === 'distribute'} onChange={() => setTransferMode('distribute')} className="mt-1" />
                <div>
                  <p className="text-xs font-black">توزيع العملاء بالتساوي على باقي السيلز المفعلين ({activeSalesAgents.length} سيلز)</p>
                </div>
              </div>

              <div 
                onClick={() => setTransferMode('single')}
                className={`p-4 rounded-2xl border transition-all cursor-pointer space-y-3 ${
                  transferMode === 'single' 
                    ? 'bg-primary-50/70 dark:bg-primary-500/10 border-primary-500 text-slate-900 dark:text-white' 
                    : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-500'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input type="radio" checked={transferMode === 'single'} onChange={() => setTransferMode('single')} className="mt-1" />
                  <div>
                    <p className="text-xs font-black">تحويل كافة العملاء إلى سيلز محدد</p>
                  </div>
                </div>

                {transferMode === 'single' && (
                  <select
                    value={singleTargetAgentId}
                    onChange={(e) => setSingleTargetAgentId(e.target.value)}
                    className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-primary-500"
                  >
                    {activeSalesAgents.map(a => (
                      <option key={a.uid} value={a.uid}>{a.name} ({a.email})</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setIsTransferModalOpen(false)}
                disabled={isProcessingTransfer}
                className="px-5 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl text-xs font-black hover:bg-slate-200 transition"
              >
                إلغاء
              </button>

              <button
                onClick={handleConfirmStandaloneTransfer}
                disabled={isProcessingTransfer}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-xs transition flex items-center gap-2 shadow-lg disabled:opacity-50"
              >
                {isProcessingTransfer ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>جاري تحويل العملاء...</span>
                  </>
                ) : (
                  <>
                    <ArrowRightLeft size={16} />
                    <span>تأكيد تحويل العملاء الآن</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}
      
      {/* Edit User Modal */}
      <FloatingPanel 
        isOpen={isEditModalOpen} 
        onClose={() => setIsEditModalOpen(false)} 
        title="تعديل الموظف"
        icon={<UserCog className="text-primary-500" />}
      >
            <form onSubmit={handleUpdateUser} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2 text-right block">الاسم</label>
                <input required className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold text-slate-900 dark:text-white border border-transparent focus:border-primary-500" value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2 text-right block">البريد الإلكتروني</label>
                <input required type="email" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold text-slate-900 dark:text-white border border-transparent focus:border-primary-500" value={editFormData.email} onChange={e => setEditFormData({...editFormData, email: e.target.value})} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2 text-right block">الصلاحية</label>
                <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none text-slate-900 dark:text-white border border-transparent focus:border-primary-500" value={editFormData.role} onChange={e => setEditFormData({...editFormData, role: e.target.value as UserRole})}>
                  {Object.values(UserRole).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <button type="submit" className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:bg-primary-600 transition-all active:scale-[0.98]">حفظ التعديلات</button>
            </form>
      </FloatingPanel>

      {/* Details Modal */}
      <FloatingPanel 
        isOpen={isDetailsModalOpen} 
        onClose={() => setIsDetailsModalOpen(false)} 
        title={selectedUser?.name || 'تفاصيل الموظف'}
        icon={<Eye size={24} className="text-primary-500" />}
        width="max-w-2xl"
      >
            {selectedUser && (
              <div className="space-y-8 pt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-3xl text-center border border-slate-100 dark:border-slate-800">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">إجمالي العملاء</p>
                    <p className="text-2xl font-black text-primary-500">{userStats[selectedUser.uid]?.totalClients || 0}</p>
                  </div>
                  <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-3xl text-center border border-slate-100 dark:border-slate-800">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">متابعات نشطة</p>
                    <p className="text-2xl font-black text-amber-500">{userStats[selectedUser.uid]?.pendingFollowups || 0}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-black flex items-center gap-2 uppercase tracking-tighter text-slate-900 dark:text-white"><Activity size={18} className="text-primary-500" /> آخر النشاطات</h3>
                  <div className="space-y-3">
                    {userLogs.length === 0 ? (
                      <p className="text-center py-10 text-slate-400 font-bold italic text-xs">لا توجد نشاطات مسجلة مؤخراً</p>
                    ) : userLogs.map(log => (
                      <div key={log.id} className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl flex justify-between items-center border border-slate-100 dark:border-slate-700/50">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{log.action}</p>
                        <span className="text-[9px] font-black text-slate-400">{new Date(log.timestamp).toLocaleString('ar-EG')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
      </FloatingPanel>
    </div>
  );
};

const QuickSummary = ({ icon: Icon, label, value, color }: any) => (
  <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-5 group hover:shadow-xl transition-all">
    <div className={`w-12 h-12 ${color} text-white rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform shrink-0`}><Icon size={24}/></div>
    <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{label}</p><p className="text-2xl font-black">{value}</p></div>
  </div>
);

export default AdminPanel;
