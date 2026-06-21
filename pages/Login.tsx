
import React, { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { doc, setDoc, getDocs, collection, query, where, updateDoc, getDoc } from 'firebase/firestore';
import { auth, db, logActivity } from '../firebase';
import { UserRole, Invitation } from '../types';
import { LayoutDashboard, AlertCircle, Chrome } from 'lucide-react';

const Login: React.FC = () => {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      
      if (!user.email) throw new Error("فشل الحصول على البريد الإلكتروني من جوجل.");

      // 1. التحقق من أن الإيميل مسموح له بالدخول
      const invitesRef = collection(db, 'invitations');
      const q = query(invitesRef, where('email', '==', user.email.toLowerCase().trim()));
      const snap = await getDocs(q);
      
      if (snap.empty) {
        // إذا لم يكن مضافاً كدعوة، نتحقق إذا كان موجوداً كأدمن رئيسي
        if (user.email.toLowerCase().trim() !== "saber.gd.fl@gmail.com") {
          await auth.signOut();
          throw new Error("عذراً، هذا البريد غير مسجل في قائمة المسموح لهم بالانضمام. يرجى مراجعة الإدارة.");
        }
      }

      // 2. التحقق من وجود وثيقة المستخدم في Firestore
      const userDocRef = doc(db, 'users', user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        let role = UserRole.SALES_AGENT;
        let invitedBy = 'system';

        if (!snap.empty) {
          const inviteDoc = snap.docs[0];
          const inviteData = inviteDoc.data() as Invitation;
          role = inviteData.role;
          invitedBy = inviteData.invitedBy;

          // تحديث حالة الدعوة
          await updateDoc(doc(db, 'invitations', inviteDoc.id), {
            status: 'used'
          });
        } else if (user.email.toLowerCase().trim() === "saber.gd.fl@gmail.com") {
          role = UserRole.ADMIN;
        }

        // إنشاء وثيقة المستخدم
        await setDoc(userDocRef, {
          name: user.displayName || 'موظف جديد',
          email: user.email.toLowerCase().trim(),
          role: role,
          invitedBy: invitedBy,
          createdAt: Date.now()
        });

        await logActivity(user.uid, user.displayName || 'موظف جديد', `تسجيل دخول لأول مرة عبر جوجل برتبة (${role})`, user.uid, user.displayName || 'موظف جديد');
      }
    } catch (err: any) {
      console.error(err);
      let errorMsg = err.message || 'فشل تسجيل الدخول عبر جوجل';
      if (err.code === 'auth/popup-closed-by-user' || err.message?.includes('closed-by-user')) {
        errorMsg = 'تم إغلاق نافذة تسجيل الدخول من قبل المستخدم أو حجبها من المتصفح (بسبب قيود الإطار المدمج). يرجى محاولة الضغط مجدداً، أو افتح الموقع بتبويب مستقل باستخدام الزر بالأسفل.';
      } else if (err.code === 'auth/cancelled-popup-request') {
        errorMsg = 'تم إلغاء عملية تسجيل الدخول بسبب تكرار الضغط. يرجى الانتظار قليلاً ثم المحاولة مرة واحدة.';
      }
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const openInNewTab = () => {
    window.open(window.location.href, '_blank');
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
                  تسجيل الدخول للنظام
                </h2>
                <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase flex items-center justify-center gap-1">
                  <AlertCircle size={10}/> مسموح فقط للإيميلات المضافة من قبل الإدارة
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-rose-50 text-rose-600 rounded-2xl text-[10px] font-black text-center border border-rose-100">
                  {error}
                </div>
              )}

              <div className="space-y-6">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="w-full py-6 rounded-3xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-black shadow-xl hover:shadow-2xl transition-all flex items-center justify-center gap-4 border border-slate-100 dark:border-slate-700 text-base"
                >
                  <Chrome className="text-rose-500" size={24} />
                  {loading ? 'جاري التحقق...' : 'الدخول عبر Gmail'}
                </button>

                <button
                  type="button"
                  onClick={openInNewTab}
                  className="w-full py-4 rounded-3xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs transition-all flex items-center justify-center gap-2 border border-transparent"
                >
                  فتح في تبويب مستقل (حل مشكلة حظر النافذة المنبثقة)
                </button>

                <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 text-center leading-relaxed">
                    يرجى استخدام إيميل Google المعتمد الخاص بك. إذا لم تتمكن من الدخول، تأكد من أن الأدمن قد أضاف إيميلك في قائمة الوصول.
                  </p>
                </div>
              </div>

              <div className="mt-8 text-center border-t border-slate-50 dark:border-slate-800 pt-6">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Educational Excellence & Management
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
