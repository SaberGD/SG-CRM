
import React, { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, getDocs, collection, query, where, updateDoc } from 'firebase/firestore';
import { auth, db, logActivity } from '../firebase';
import { UserRole, Invitation } from '../types';
import { LayoutDashboard, Lock, UserPlus, AlertCircle, Mail, User } from 'lucide-react';

const Login: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        // 1. التحقق من أن الإيميل مسموح له بالتسجيل
        const invitesRef = collection(db, 'invitations');
        const q = query(invitesRef, where('email', '==', email.toLowerCase().trim()));
        const snap = await getDocs(q);
        
        if (snap.empty) {
          throw new Error("عذراً، هذا البريد غير مسجل في قائمة المسموح لهم بالانضمام. يرجى مراجعة الإدارة.");
        }
        
        const inviteDoc = snap.docs[0];
        const inviteData = inviteDoc.data() as Invitation;
        
        if (inviteData.status === 'used') {
          // التحقق مما إذا كان المستخدم موجوداً بالفعل في الداتابيز
          const userDoc = await getDocs(query(collection(db, 'users'), where('email', '==', email.toLowerCase().trim())));
          if (!userDoc.empty) {
            throw new Error("هذا الحساب تم تفعيله مسبقاً. حاول تسجيل الدخول.");
          }
          // إذا كانت الدعوة مستخدمة ولكن لا يوجد يوزر، سنكمل العملية (ربما فشل الإنشاء سابقاً)
        }

        let user;
        try {
          // 2. إنشاء الحساب في Firebase Auth
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          user = userCredential.user;
        } catch (authErr: any) {
          if (authErr.code === 'auth/email-already-in-use') {
            // إذا كان الإيميل موجوداً في Auth، نحاول تسجيل الدخول به لإكمال البيانات
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            user = userCredential.user;
          } else {
            throw authErr;
          }
        }
        
        // 3. تخزين بيانات المستخدم مع الرتبة المحددة في الدعوة مسبقاً
        await setDoc(doc(db, 'users', user.uid), {
          name: name,
          email: email.toLowerCase().trim(),
          role: inviteData.role,
          invitedBy: inviteData.invitedBy,
          createdAt: Date.now()
        });
        
        // 4. تحديث حالة الدعوة إلى مستخدمة
        await updateDoc(doc(db, 'invitations', inviteDoc.id), {
          status: 'used'
        });

        await logActivity(user.uid, name, `تسجيل حساب جديد بنجاح برتبة (${inviteData.role})`, user.uid, name);
      }
    } catch (err: any) {
      console.error(err);
      let errMsg = err.message;
      if (err.code === 'auth/email-already-in-use') errMsg = "هذا البريد مستخدم بالفعل.";
      if (err.code === 'auth/weak-password') errMsg = "كلمة المرور ضعيفة جداً.";
      setError(errMsg || 'تأكد من صحة البيانات المدخلة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-primary-500/10 rounded-full blur-[120px]"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[120px]"></div>

      <div className="w-full max-w-[500px] z-10 animate-fade-in">
        <div className="text-center mb-10">
          <div className="w-20 h-20 bg-white dark:bg-slate-900 rounded-[2rem] shadow-2xl flex items-center justify-center mb-6 mx-auto border border-slate-100 dark:border-slate-800">
            <LayoutDashboard className="text-primary-500" size={40} />
          </div>
          <h1 className="text-3xl font-black text-slate-950 dark:text-white uppercase tracking-tighter">
            SABER GROUP <span className="text-primary-500">CRM SYSTEM</span>
          </h1>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
          <div className="p-8 md:p-12">
            <div className="animate-fade-in">
              <div className="text-center mb-8">
                <h2 className="text-xl font-black text-slate-800 dark:text-slate-200">
                  {isLogin ? 'تسجيل الدخول' : 'إنشاء حساب موظف'}
                </h2>
                {!isLogin && (
                  <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase flex items-center justify-center gap-1">
                    <AlertCircle size={10}/> مسموح فقط للإيميلات المضافة من قبل الإدارة
                  </p>
                )}
              </div>

              {error && (
                <div className="mb-6 p-4 bg-rose-50 text-rose-600 rounded-2xl text-[10px] font-black text-center border border-rose-100">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin && (
                  <div className="relative">
                    <User className="absolute right-5 top-1/2 -translate-y-1/2 text-primary-500" size={18}/>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full pr-14 pl-6 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-transparent focus:border-primary-500 outline-none font-bold text-sm"
                      placeholder="الاسم الثنائي"
                      required={!isLogin}
                    />
                  </div>
                )}
                
                <div className="relative">
                  <Mail className="absolute right-5 top-1/2 -translate-y-1/2 text-primary-500" size={18}/>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pr-14 pl-6 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-transparent focus:border-primary-500 outline-none font-bold text-sm"
                    placeholder="البريد الإلكتروني"
                    required
                  />
                </div>

                <div className="relative">
                  <Lock className="absolute right-5 top-1/2 -translate-y-1/2 text-primary-500" size={18}/>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pr-14 pl-6 py-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-transparent focus:border-primary-500 outline-none font-bold text-sm"
                    placeholder="كلمة المرور"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-5 rounded-3xl bg-primary-500 text-white font-black shadow-xl hover:bg-primary-600 transition-all flex items-center justify-center gap-2 mt-4 uppercase text-xs tracking-widest"
                >
                  {loading ? 'جاري التحقق...' : (isLogin ? 'دخول النظام' : 'تفعيل الحساب')}
                </button>
              </form>

              <div className="mt-8 text-center border-t border-slate-50 dark:border-slate-800 pt-6">
                <button onClick={() => setIsLogin(!isLogin)} className="text-primary-500 font-black text-xs uppercase tracking-tighter">
                  {isLogin ? 'موظف جديد؟ سجل حسابك هنا' : 'لديك حساب بالفعل؟ سجل دخولك'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
