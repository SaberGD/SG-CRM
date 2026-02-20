
// Namespaced imports for Firebase to resolve resolution issues in some TypeScript environments.
import * as firebaseApp from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import * as firestore from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBSFF4AoMTc6djItxJ-YmXAkDYha1M41Pg",
  authDomain: "sg-crm-e3a38.firebaseapp.com",
  projectId: "sg-crm-e3a38",
  storageBucket: "sg-crm-e3a38.firebasestorage.app",
  messagingSenderId: "769940162978",
  appId: "1:769940162978:web:a47c53047a0047dde88afb",
  measurementId: "G-RVK15HVS51"
};

const app = firebaseApp.initializeApp(firebaseConfig);
export const auth = firebaseAuth.getAuth(app);

/**
 * تهيئة Firestore باستخدام getFirestore وتجنب مشاكل التصدير عبر Namespace.
 */
export const db = firestore.getFirestore(app);

/**
 * تسجيل النشاطات مع حماية ضد القيم undefined التي تسبب توقف Firestore SDK.
 */
export const logActivity = async (userId: string, userName: string, action: string, targetId: string, targetName: string) => {
  try {
    await firestore.addDoc(firestore.collection(db, 'logs'), {
      userId: userId || 'unknown',
      userName: userName || 'موظف غير معروف',
      action: action || 'نشاط غير محدد',
      targetId: targetId || 'none',
      targetName: targetName || 'غير محدد',
      timestamp: Date.now()
    });
  } catch (error) {
    console.error("Critical: Error logging activity:", error);
  }
};
