
import React, { useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { doc, setDoc, getDocs, collection, query, where, updateDoc, getDoc } from 'firebase/firestore';
import { auth, db, logActivity } from '../firebase';
import { UserRole, Invitation } from '../types';
import { AlertCircle, Chrome } from 'lucide-react';

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
    <div className="sg-crm-login" dir="rtl">
      <div className="sg-crm-login-card animate-fade-in">
        <img src="/saber-group-logo.png" alt="Saber Group" />
        <h1>تسجيل الدخول لنظام المبيعات</h1>
        <p>الدخول مسموح للإيميلات اللي الإدارة ضافتها بس.</p>

        {error && <div className="sg-crm-login-error" role="alert">{error}</div>}

        <div className="sg-crm-login-actions">
          <button type="button" onClick={handleGoogleLogin} disabled={loading} className="sgui-button is-primary">
            <Chrome size={18} aria-hidden="true" />
            {loading ? 'جاري التحقق...' : 'الدخول بحساب Google'}
          </button>
          <button type="button" onClick={openInNewTab} className="sgui-button">
            فتح في تبويب مستقل (لو نافذة الدخول اتمنعت)
          </button>
        </div>

        <div className="sg-crm-login-note">
          <AlertCircle size={14} aria-hidden="true" />
          <span>استخدم إيميل Google المعتمد بتاعك. لو مش قادر تدخل، اتأكد إن الأدمن ضاف إيميلك في قائمة الوصول.</span>
        </div>
      </div>
    </div>
  );
};

export default Login;
