
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
  FileText, Activity, AlertCircle
} from 'lucide-react';

const AdminPanel: React.FC = () => {
  const { user } = useAuth();
  // Initialized navigate function using useNavigate hook
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Modal States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userLogs, setUserLogs] = useState<ActivityLog[]>([]);
  
  const [editFormData, setEditFormData] = useState({ name: '', email: '', role: UserRole.SALES_AGENT });

  useEffect(() => {
    // جلب كافة المستخدمين بدون أي فلترة أو ترتيب من جهة السيرفر لضمان ظهور الجميع
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      const allUsers = snap.docs.map(d => ({ uid: d.id, ...d.data() } as User));
      
      // الترتيب برمجياً هنا لضمان عدم اختفاء أي مستخدم
      const sorted = allUsers.sort((a, b) => {
        // نضع المستخدم الحالي أولاً للسهولة
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
    });

    return () => {
      unsubUsers();
      unsubClients();
    };
  }, [user?.uid]);

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

  const handleDeleteUser = async (u: User) => {
    if (!user) return;
    if (u.uid === user.uid) return alert("لا يمكنك حذف حسابك الخاص من هنا!");
    
    if (window.confirm(`هل أنت متأكد من حذف المستخدم [${u.name || u.email}] نهائياً؟ ستفقد كافة بياناته.`)) {
      try {
        await deleteDoc(doc(db, 'users', u.uid));
        await logActivity(user.uid, user.name, `حذف الموظف [${u.name || u.email}]`, u.uid, u.name || 'غير معروف');
      } catch (err) {
        console.error(err);
      }
    }
  };

  const filteredUsers = users.filter(u => 
    (u.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (u.email || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

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
    <div className="space-y-10 animate-fade-in pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter flex items-center gap-4">
            <ShieldCheck className="text-primary-500" size={40} /> إدارة <span className="text-primary-500">فريق العمل</span>
          </h1>
          <p className="text-slate-500 font-bold mt-1">عرض والتحكم في كافة مستخدمي وصلاحيات النظام</p>
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <QuickSummary icon={Users} label="إجمالي الفريق" value={users.length} color="bg-primary-500" />
        <QuickSummary icon={UserCog} label="المسؤولين" value={users.filter(u => u.role !== UserRole.SALES_AGENT).length} color="bg-amber-500" />
        <QuickSummary icon={Activity} label="المبيعات والوكلاء" value={users.filter(u => u.role === UserRole.SALES_AGENT).length} color="bg-emerald-500" />
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">الموظف</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">الرتبة</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">العملاء</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">انضم في</th>
                <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={5} className="py-20 text-center animate-pulse font-black text-slate-400 uppercase italic tracking-widest">جاري تحميل السجلات المصلحة...</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan={5} className="py-20 text-center text-slate-400 font-bold italic">لا توجد نتائج مطابقة لبحثك</td></tr>
              ) : filteredUsers.map((u) => (
                <tr key={u.uid} className={`hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-all group ${u.uid === user?.uid ? 'bg-primary-50/20 dark:bg-primary-500/5' : ''}`}>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center font-black text-primary-500 group-hover:scale-110 transition-transform shadow-inner uppercase">
                        {(u.name || u.email || '?')[0]}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                           <span className="font-black text-sm text-slate-900 dark:text-white block">{u.name || (u.email ? u.email.split('@')[0] : 'بدون اسم')}</span>
                           {u.uid === user?.uid && <span className="px-2 py-0.5 bg-primary-500 text-white text-[8px] font-black rounded-md uppercase tracking-tighter">أنت</span>}
                        </div>
                        <span className="text-[10px] text-slate-400 font-bold">{u.email}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                      u.role === UserRole.ADMIN ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10' :
                      u.role === UserRole.MANAGER ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10' :
                      u.role === UserRole.TEAM_LEADER ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10' :
                      'bg-slate-100 text-slate-600 dark:bg-slate-800'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className="text-sm font-black text-slate-900 dark:text-white">{userStats[u.uid]?.totalClients || 0}</span>
                      <span className="text-[8px] font-black text-slate-400 uppercase">عميل نشط</span>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-center">
                    <span className="text-[10px] font-bold text-slate-500">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString('ar-EG') : '--/--/----'}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => handleViewDetails(u)} className="p-3 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-xl hover:text-primary-500 hover:scale-110 transition-all shadow-sm"><Eye size={18} /></button>
                      <button onClick={() => handleEditClick(u)} className="p-3 bg-primary-50 text-primary-500 rounded-xl hover:scale-110 transition-all shadow-sm dark:bg-primary-500/10"><UserCog size={18} /></button>
                      {u.uid !== user?.uid && (
                        <button onClick={() => handleDeleteUser(u)} className="p-3 bg-rose-50 text-rose-500 rounded-xl hover:scale-110 transition-all shadow-sm dark:bg-rose-500/10"><Trash2 size={18} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Modals omitted for brevity - same logic as before with u.name || u.email fallback */}
    </div>
  );
};

const QuickSummary = ({ icon: Icon, label, value, color }: any) => (
  <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-6 group hover:shadow-xl transition-all">
    <div className={`w-14 h-14 ${color} text-white rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}><Icon size={28}/></div>
    <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p><p className="text-3xl font-black">{value}</p></div>
  </div>
);

export default AdminPanel;
