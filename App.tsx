
import React, { useState, useEffect, createContext, useContext } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
// Namespaced import to fix "no exported member" errors.
import * as firestore from 'firebase/firestore';
import { auth, db } from './firebase';
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
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        try {
          const userDocRef = firestore.doc(db, 'users', firebaseUser.uid);
          const userDoc = await firestore.getDoc(userDocRef);
          
          if (userDoc.exists()) {
            const data = userDoc.data();
            if (!data.name || data.name === 'مستخدم' || data.name === '') {
              const fixedName = firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'مدير النظام';
              try {
                await firestore.updateDoc(userDocRef, { name: fixedName });
              } catch (e) { console.warn("Permission denied for self-repair, using local values."); }
              const userData = { uid: firebaseUser.uid, ...data, name: fixedName } as User;
              setUser(userData);
              setEffectiveRoleState(userData.role);
            } else {
              const userData = { uid: firebaseUser.uid, ...data } as User;
              setUser(userData);
              const savedRole = localStorage.getItem('viewAsRole') as UserRole;
              setEffectiveRoleState(savedRole && userData.role === UserRole.ADMIN ? savedRole : userData.role);
            }
          } else { 
            const repairData = {
              name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'مدير النظام',
              email: firebaseUser.email || '',
              role: UserRole.ADMIN,
              createdAt: Date.now()
            };
            try {
              await firestore.setDoc(userDocRef, repairData);
            } catch (e) { console.error("Critical: Could not create user document. Check Firestore Rules."); }
            const userData = { uid: firebaseUser.uid, ...repairData } as User;
            setUser(userData);
            setEffectiveRoleState(userData.role);
          }
        } catch (error) {
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
