
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
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't throw here to avoid crashing the whole app, but we log it clearly.
  return errInfo;
}

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
