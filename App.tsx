
import React, { useState, useEffect, createContext, useContext } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
// Namespaced import to fix "no exported member" errors.
import * as firestore from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { User, UserRole } from './types';

import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ClientsList from './pages/ClientsList';
import ClientDetails from './pages/ClientDetails';
import Notifications from './pages/Notifications';
import Reports from './pages/Reports';
import ActivityLogs from './pages/ActivityLogs';
import BackupManager from './pages/BackupManager';
import ServicesManager from './pages/ServicesManager';
import LabelsManager from './pages/LabelsManager';
import InvitesManager from './pages/InvitesManager';
import AdminPanel from './pages/AdminPanel';

interface AuthContextType {
  user: User | null;
  effectiveRole: UserRole | null;
  setEffectiveRole: (role: UserRole | null) => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ 
  user: null, 
  effectiveRole: null, 
  setEffectiveRole: () => {}, 
  loading: true 
});

export const useAuth = () => useContext(AuthContext);

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [effectiveRole, setEffectiveRoleState] = useState<UserRole | null>(null);
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
            // Normalize roles if they are coming from a different source or legacy data
            let role = data.role as string;
            if (role === 'sales') role = UserRole.SALES_AGENT;
            if (role === 'supervisor') role = UserRole.MANAGER;
            if (role === 'leader') role = UserRole.TEAM_LEADER;
            if (role === 'administrator') role = UserRole.ADMIN;

            if (!data.name || data.name === 'مستخدم' || data.name === '') {
              const fixedName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'مدير النظام';
              try {
                await firestore.updateDoc(userDocRef, { name: fixedName });
              } catch (e) { 
                handleFirestoreError(e, OperationType.UPDATE, `users/${firebaseUser.uid}`);
                console.warn("Permission denied for self-repair, using local values."); 
              }
              const userData = { uid: firebaseUser.uid, ...data, name: fixedName, role: role as UserRole } as User;
              console.log("User Logged In (Repaired):", userData.name, "Role:", userData.role);
              setUser(userData);
              setEffectiveRoleState(userData.role);
            } else {
              const userData = { uid: firebaseUser.uid, ...data, role: role as UserRole } as User;
              console.log("User Logged In:", userData.name, "Role:", userData.role);
              setUser(userData);
              const savedRole = localStorage.getItem('viewAsRole') as UserRole;
              setEffectiveRoleState(savedRole && userData.role === UserRole.ADMIN ? savedRole : userData.role);
            }
          } else { 
            // Only auto-create if it's the main admin bootstrapping
            const isMainAdmin = firebaseUser.email === "saber.gd.fl@gmail.com";
            const repairData = {
              name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || (isMainAdmin ? 'مدير النظام' : 'مستخدم جديد'),
              email: firebaseUser.email || '',
              role: isMainAdmin ? UserRole.ADMIN : UserRole.SALES_AGENT,
              createdAt: Date.now()
            };
            
            if (isMainAdmin) {
              try {
                await firestore.setDoc(userDocRef, repairData);
                const userData = { uid: firebaseUser.uid, ...repairData } as User;
                setUser(userData);
                setEffectiveRoleState(userData.role);
              } catch (e) { 
                handleFirestoreError(e, OperationType.CREATE, `users/${firebaseUser.uid}`);
                console.error("Critical: Could not create admin document."); 
              }
            } else {
              // For non-admins, if document is missing, they might be in the middle of signup
              // or their document creation failed. We'll set a temporary state.
              console.warn("User document missing for non-admin. Signup might be in progress.");
              setUser({ uid: firebaseUser.uid, email: firebaseUser.email || '', name: repairData.name, role: UserRole.SALES_AGENT });
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
          console.error("Auth Sync Permission Error:", error);
          // Fallback minimal user object if Firestore is locked
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

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-slate-950">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
    </div>
  );

  return (
    <AuthContext.Provider value={{ user, effectiveRole, setEffectiveRole, loading }}>
      <HashRouter>
        <Routes>
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
          <Route element={user ? <Layout /> : <Navigate to="/login" />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/clients" element={<ClientsList />} />
            <Route path="/clients/:id" element={<ClientDetails />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/services" element={<ServicesManager />} />
            <Route path="/labels" element={<LabelsManager />} />
            <Route path="/activity" element={<ActivityLogs />} />
            <Route path="/backup" element={<BackupManager />} />
            <Route path="/invites" element={<InvitesManager />} />
            <Route path="/admin" element={<AdminPanel />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthContext.Provider>
  );
};

export default App;
