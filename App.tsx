
import React, { useState, useEffect, createContext, useContext, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
// Namespaced import to fix "no exported member" errors.
import * as firestore from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { User, UserRole } from './types';

import Layout from './components/Layout';
import { ShiftProvider } from './ShiftContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { LoadingState } from './components/ui';

// Every other page is its own file, downloaded the first time it is opened, so the first
// screen loads only what it needs (the app used to be one 1.8 MB file).
const ClientsList = lazy(() => import('./pages/ClientsList'));
const ClientDetails = lazy(() => import('./pages/ClientDetails'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Reports = lazy(() => import('./pages/Reports'));
const ActivityLogs = lazy(() => import('./pages/ActivityLogs'));
const BackupManager = lazy(() => import('./pages/BackupManager'));
const ServicesManager = lazy(() => import('./pages/ServicesManager'));
const LabelsManager = lazy(() => import('./pages/LabelsManager'));
const InvitesManager = lazy(() => import('./pages/InvitesManager'));
const DuplicatesManager = lazy(() => import('./pages/DuplicatesManager'));
const TodayWork = lazy(() => import('./pages/TodayWork'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const AiAssistant = lazy(() => import('./pages/AiAssistant').then((m) => ({ default: m.AiAssistant })));

interface AuthContextType {
  user: User | null;
  effectiveRole: UserRole | null;
  setEffectiveRole: (role: UserRole | null) => void;
  viewingAsUser: User | null;
  setViewingAsUser: (target: User | null) => void;
  effectiveUser: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  effectiveRole: null,
  setEffectiveRole: () => {},
  viewingAsUser: null,
  setViewingAsUser: () => {},
  effectiveUser: null,
  loading: true
});

export const useAuth = () => useContext(AuthContext);

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [effectiveRole, setEffectiveRoleState] = useState<UserRole | null>(null);
  const [viewingAsUser, setViewingAsUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Test Firestore connection
    const testConnection = async () => {
      try {
        await firestore.getDocFromCache(firestore.doc(db, 'users', 'connection-test'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client appears to be offline.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        try {
          const userDocRef = firestore.doc(db, 'users', firebaseUser.uid);
          const userDoc = await firestore.getDoc(userDocRef);
          
          if (userDoc.exists()) {
            const data = userDoc.data();
            let role = data.role as string;
            // Normalize roles
            if (role === 'sales') role = UserRole.SALES_AGENT;
            if (role === 'supervisor') role = UserRole.SUPERVISOR;
            if (role === 'leader') role = UserRole.TEAM_LEADER;
            if (role === 'administrator') role = UserRole.ADMIN;

            const userData = { uid: firebaseUser.uid, ...data, role: role as UserRole } as User;
            
            // Repair name if missing
            if (!data.name || data.name === 'مستخدم' || data.name === '') {
              const fixedName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'موظف';
              try {
                await firestore.updateDoc(userDocRef, { name: fixedName });
                userData.name = fixedName;
              } catch (e) { console.warn("Self-repair failed:", e); }
            }

            console.log("User Logged In:", userData.name, "Role:", userData.role);
            setUser(userData);
            const savedRole = localStorage.getItem('viewAsRole') as UserRole;
            setEffectiveRoleState(savedRole && userData.role === UserRole.ADMIN ? savedRole : userData.role);

            const savedViewAsUserId = userData.role === UserRole.ADMIN ? localStorage.getItem('viewingAsUserId') : null;
            if (savedViewAsUserId) {
              try {
                const targetDoc = await firestore.getDoc(firestore.doc(db, 'users', savedViewAsUserId));
                if (targetDoc.exists()) {
                  const targetData = { uid: targetDoc.id, ...targetDoc.data() } as User;
                  setViewingAsUserState(targetData);
                  setEffectiveRoleState(targetData.role);
                } else {
                  localStorage.removeItem('viewingAsUserId');
                }
              } catch (e) {
                console.warn('Failed to restore view-as user:', e);
              }
            }
          } else { 
            // Document missing - Check if main admin or invited
            const isMainAdmin = firebaseUser.email === "saber.gd.fl@gmail.com";
            
            if (isMainAdmin) {
              const adminData = {
                name: firebaseUser.displayName || "مدير النظام",
                email: firebaseUser.email || '',
                role: UserRole.ADMIN,
                createdAt: Date.now()
              };
              await firestore.setDoc(userDocRef, adminData);
              setUser({ uid: firebaseUser.uid, ...adminData } as User);
              setEffectiveRoleState(UserRole.ADMIN);
            } else {
              // Check for invitation
              const inviteQuery = firestore.query(
                firestore.collection(db, 'invitations'), 
                firestore.where('email', '==', firebaseUser.email?.toLowerCase().trim()),
                firestore.where('status', '==', 'pending'),
                firestore.limit(1)
              );
              const inviteSnap = await firestore.getDocs(inviteQuery);
              
              if (!inviteSnap.empty) {
                const inviteData = inviteSnap.docs[0].data();
                const newUser = {
                  name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'موظف مبيعات',
                  email: firebaseUser.email || '',
                  role: inviteData.role as UserRole,
                  createdAt: Date.now(),
                  invitedBy: inviteData.invitedBy
                };
                await firestore.setDoc(userDocRef, newUser);
                await firestore.updateDoc(firestore.doc(db, 'invitations', inviteSnap.docs[0].id), { status: 'used' });
                setUser({ uid: firebaseUser.uid, ...newUser } as User);
                setEffectiveRoleState(newUser.role);
                console.log("User document created from invitation.");
              } else {
                console.warn("No invitation found for:", firebaseUser.email);
                setUser({ uid: firebaseUser.uid, email: firebaseUser.email || '', name: 'مستخدم غير مسجل', role: UserRole.SALES_AGENT });
              }
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
          setUser({ uid: firebaseUser.uid, email: firebaseUser.email || '', name: 'مستخدم (محدود)', role: UserRole.SALES_AGENT });
        }
      } else { 
        setUser(null); 
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const setEffectiveRole = (role: UserRole | null) => {
    if (user?.role === UserRole.ADMIN) {
      const newRole = role || user.role;
      setEffectiveRoleState(newRole);
      localStorage.setItem('viewAsRole', newRole);
    }
  };

  // Lets an admin browse the app scoped to a specific sales agent's own data
  // (their clients, dashboard, notifications) -- not just a generic role
  // switch. Writes/activity logs still go through the real admin's own uid
  // (see useAuth() callers), and the shift system and "my report" tab in
  // Reports intentionally ignore this (view-only, never act on someone
  // else's live shift or submit a report in their name).
  const setViewingAsUser = (target: User | null) => {
    if (user?.role !== UserRole.ADMIN) return;
    setViewingAsUserState(target);
    if (target) {
      localStorage.setItem('viewingAsUserId', target.uid);
      setEffectiveRoleState(target.role);
      localStorage.setItem('viewAsRole', target.role);
    } else {
      localStorage.removeItem('viewingAsUserId');
      setEffectiveRoleState(user.role);
      localStorage.setItem('viewAsRole', user.role);
    }
  };

  const effectiveUser = viewingAsUser || user;

  if (loading) return (
    <div className="sg-crm-loader" role="status" aria-label="جاري التحميل"><span></span></div>
  );

  if (user?.isDeactivated) {
    return (
      <div className="sg-crm-login" dir="rtl">
        <div className="sg-crm-login-card">
          <img src="/saber-group-logo.png" alt="Saber Group" />
          <h1>حسابك متوقف عن العمل حالياً</h1>
          <p>الإدارة أوقفت صلاحيات الحساب ده. لو شايف إن ده حصل بالغلط، كلّم مسؤول النظام.</p>
          <div className="sg-crm-login-actions">
            <button type="button" onClick={() => auth.signOut()} className="sgui-button">تسجيل الخروج</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, effectiveRole, setEffectiveRole, viewingAsUser, setViewingAsUser, effectiveUser, loading }}>
      <HashRouter>
        <Routes>
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
          <Route element={user ? <ShiftProvider><Layout /></ShiftProvider> : <Navigate to="/login" />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/today" element={<TodayWork />} />
            <Route path="/clients" element={<ClientsList />} />
            <Route path="/clients/:id" element={<ClientDetails />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/ai-assistant" element={user?.role === UserRole.ADMIN ? <AiAssistant /> : <Navigate to="/clients" replace />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/services" element={<ServicesManager />} />
            <Route path="/labels" element={<LabelsManager />} />
            <Route path="/activity" element={<ActivityLogs />} />
            <Route path="/backup" element={<BackupManager />} />
            <Route path="/invites" element={<InvitesManager />} />
            <Route path="/duplicates" element={<DuplicatesManager />} />
            <Route path="/admin" element={<AdminPanel />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthContext.Provider>
  );
};

export default App;
