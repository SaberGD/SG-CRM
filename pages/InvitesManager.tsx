
import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, doc, updateDoc, deleteDoc, where } from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { Invitation, UserRole } from '../types';
import { UserPlus, Mail, Shield, Trash2, Clock, UserCheck } from 'lucide-react';

const InvitesManager: React.FC = () => {
  const { user, effectiveRole } = useAuth();
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form states
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.SALES_AGENT);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAdmin = effectiveRole === UserRole.ADMIN;
  const isHighRole = isAdmin || effectiveRole === UserRole.MANAGER || effectiveRole === UserRole.TEAM_LEADER;

  useEffect(() => {
    if (!user) return;
    const q = isAdmin 
      ? query(collection(db, 'invitations'), orderBy('timestamp', 'desc'))
      : query(collection(db, 'invitations'), where('invitedBy', '==', user.uid), orderBy('timestamp', 'desc'));

    const unsub = onSnapshot(q, (snap) => {
      setInvites(snap.docs.map(d => ({ id: d.id, ...d.data() } as Invitation)));
      setLoading(false);
    });
    return unsub;
  }, [user, effectiveRole]);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isSubmitting) return;

    if (!isAdmin && role !== UserRole.SALES_AGENT) {
      alert("عذراً، يمكنك دعوة موظفي مبيعات فقط.");
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'invitations'), {
        email: email.toLowerCase().trim(),
        role,
        token: '', // لم نعد بحاجة للتوكن
        status: 'pending',
        invitedBy: user.uid,
        invitedByName: user.name,
        timestamp: Date.now()
      });
      await logActivity(user.uid, user.name, `إضافة بريد موثوق للتسجيل (${role})`, "invitation", email);
      setIsModalOpen(false);
      setEmail('');
      setRole(UserRole.SALES_AGENT);
    } catch (err) {
      console.error(err);
      alert("فشل إضافة البريد");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isHighRole) return <div className="text-center py-40 font-black">غير مصرح لك بدخول هذه الصفحة</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-10 animate-fade-in pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">سجل <span className="text-primary-500">الوصول</span></h1>
          <p className="text-slate-500 font-bold mt-1">تحديد الإيميلات المسموح لها بإنشاء حسابات في النظام</p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="bg-primary-500 text-white px-8 py-4 rounded-3xl font-black text-xs uppercase shadow-xl hover:bg-primary-600 transition-all flex items-center gap-2">
          <UserPlus size={18} /> إضافة إيميل مسموح
        </button>
      </header>

      <div className="bg-white dark:bg-slate-900 rounded-[3rem] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">البريد الإلكتروني</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">الرتبة الممنوحة</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">حالة الحساب</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">تمت الإضافة بواسطة</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {invites.length === 0 ? (
                <tr><td colSpan={5} className="px-8 py-20 text-center text-slate-400 font-bold italic">لا توجد إيميلات مسجلة حالياً</td></tr>
              ) : invites.map((invite) => (
                <tr key={invite.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-all">
                  <td className="px-8 py-6">
                    <p className="font-black text-sm text-slate-900 dark:text-white">{invite.email}</p>
                    <p className="text-[9px] font-bold text-slate-400 mt-1 uppercase flex items-center gap-1"><Clock size={10}/> {new Date(invite.timestamp).toLocaleDateString('ar-EG')}</p>
                  </td>
                  <td className="px-8 py-6">
                    <span className="text-[10px] font-black bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-1 rounded-full uppercase tracking-tighter">
                      {invite.role}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-center">
                    <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase flex items-center justify-center gap-2 mx-auto w-fit ${invite.status === 'used' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                      {invite.status === 'used' ? <><UserCheck size={12}/> مسجل بالفعل</> : 'ينتظر التسجيل'}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-center text-xs text-slate-500 font-bold">{invite.invitedByName}</td>
                  <td className="px-8 py-6 text-center">
                    <button onClick={async () => { if(confirm("حذف هذا الإيميل من قائمة الوصول؟")) await deleteDoc(doc(db, 'invitations', invite.id)); }} className="p-3 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-500 hover:text-white transition-all"><Trash2 size={16}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 backdrop-blur-md p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-lg p-10 space-y-6 animate-fade-in shadow-2xl border border-slate-100 dark:border-slate-800">
             <div className="flex justify-between items-center">
               <h2 className="text-2xl font-black flex items-center gap-3"><Mail className="text-primary-500" /> إضافة إيميل جديد</h2>
               <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-900 transition-colors"><Trash2 size={24}/></button>
             </div>
             <form onSubmit={handleSendInvite} className="space-y-6">
               <div className="space-y-1.5">
                 <label className="text-[10px] font-black uppercase text-slate-400 mr-2">البريد الإلكتروني المسموح له بالتسجيل</label>
                 <input 
                   required 
                   type="email"
                   className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none border border-transparent focus:border-primary-500/50" 
                   placeholder="example@academy.com" 
                   value={email} 
                   onChange={e => setEmail(e.target.value)} 
                 />
               </div>
               <div className="space-y-1.5">
                 <label className="text-[10px] font-black uppercase text-slate-400 mr-2 flex items-center gap-1"><Shield size={12}/> تحديد الرتبة الوظيفية</label>
                 <select 
                   className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none border border-transparent focus:border-primary-500/50" 
                   value={role} 
                   onChange={e => setRole(e.target.value as UserRole)}
                 >
                   <option value={UserRole.SALES_AGENT}>Sales Agent (موظف مبيعات)</option>
                   {isAdmin && (
                     <>
                        <option value={UserRole.TEAM_LEADER}>Team Leader (رئيس فريق)</option>
                        <option value={UserRole.MANAGER}>Supervisor / Manager (مدير نظام)</option>
                        <option value={UserRole.ADMIN}>Administrator (أدمن كامل)</option>
                     </>
                   )}
                 </select>
               </div>
               <div className="p-5 bg-primary-50/50 dark:bg-primary-500/5 rounded-2xl border border-primary-100 dark:border-primary-500/10">
                 <p className="text-[10px] font-bold text-slate-500 leading-relaxed">
                   بمجرد إضافة هذا الإيميل، سيتمكن الموظف من الدخول للنظام والقيام بـ "إنشاء حساب" ببريده الشخصي فوراً دون الحاجة لأكواد إضافية.
                 </p>
               </div>
               <button 
                 type="submit" 
                 disabled={isSubmitting}
                 className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:bg-primary-600 transition-all flex items-center justify-center gap-2"
               >
                 {isSubmitting ? 'جاري الإضافة...' : 'إضافة للقائمة الموثوقة'}
               </button>
             </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvitesManager;
