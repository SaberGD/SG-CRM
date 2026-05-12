
// Namespaced imports for Firebase to resolve resolution issues in some TypeScript environments.
import * as firebaseApp from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import * as firestore from 'firebase/firestore';

// Import the Firebase configuration from the config file if it exists
import firebaseConfig from './firebase-applet-config.json';

const app = firebaseApp.initializeApp(firebaseConfig);
export const auth = firebaseAuth.getAuth(app);

/**
 * تهيئة Firestore باستخدام getFirestore وتجنب مشاكل التصدير عبر Namespace.
 */
export const db = firestore.getFirestore(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  const errorMessage = JSON.stringify(errInfo);
  console.error('Firestore Error: ', errorMessage);
  throw new Error(errorMessage);
}

/**
 * تنظيف رقم الهاتف من المسافات وكود الدولة المكرر
 */
export function cleanPhoneNumber(input: string, countryCode: string): string {
  if (!input) return '';
  
  // 1. إزالة كافة الرموز غير الرقمية (إلا علامة + في البداية إذا وجدت ولكننا سنركز على الأرقام للتنظيف)
  let cleaned = input.replace(/[^\d+]/g, '');
  
  // 2. استخراج الأرقام فقط من كود الدولة (مثال: +20 تصبح 20)
  const codeDigits = countryCode.replace(/\D/g, '');
  
  if (codeDigits) {
     const plusPrefix = '+' + codeDigits;
     const doubleZeroPrefix = '00' + codeDigits;
     
     // إذا كان الرقم يبدأ بكود الدولة مسبوقاً بـ + أو 00
     if (cleaned.startsWith(plusPrefix)) {
       cleaned = cleaned.substring(plusPrefix.length);
     } else if (cleaned.startsWith(doubleZeroPrefix)) {
       cleaned = cleaned.substring(doubleZeroPrefix.length);
     } else if (cleaned.startsWith(codeDigits) && !cleaned.startsWith('0')) {
       // تجنب الخلط بين رقم يبدأ بـ 0 وكود دولة يبدأ بنفس الأرقام
       cleaned = cleaned.substring(codeDigits.length);
     }
  }
  
  // 3. إزالة أي أصفار في البداية (مثل 010 تصبح 10) ليتم إضافتها عبر الكود الموحد في النظام
  cleaned = cleaned.replace(/^0+/, '');
  
  return cleaned;
}

// CRITICAL: Connection test
async function testConnection() {
  try {
    await firestore.getDocFromServer(firestore.doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client appears to be offline.");
    }
  }
}
testConnection();

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
    handleFirestoreError(error, OperationType.CREATE, 'logs');
  }
};
