
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
import { AiAssistant } from './pages/AiAssistant';

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
            let role = data.role as string;
            // Normalize roles
            if (role === 'sales') role = UserRole.SALES_AGENT;
            if (role === 'supervisor') role = UserRole.MANAGER;
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
            <Route path="/ai-assistant" element={<AiAssistant />} />
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
