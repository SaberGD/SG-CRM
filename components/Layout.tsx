
import React, { useState, useEffect, useRef } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../App';
import { auth, db, logActivity } from '../firebase';
import { signOut } from 'firebase/auth';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { 
  LayoutDashboard, Users, Bell, BarChart3, LogOut, Menu, X, ClipboardList, Sun, Moon, BellRing, Volume2, VolumeX, BookOpen, Tag, Eye, AlertTriangle, PhoneOutgoing, UserPlus, ShieldCheck, UserCog, Database
} from 'lucide-react';
import { UserRole, Client } from '../types';

const AlarmManager: React.FC<{ user: any }> = ({ user }) => {
  const [activeAlarm, setActiveAlarm] = useState<Client | null>(null);
  const [hasOverdueTasks, setHasOverdueTasks] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [dangerMuted, setDangerMuted] = useState(false);
  
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const dangerToneRef = useRef<HTMLAudioElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    const clientsRef = collection(db, 'clients');
    // Only listen for clients that have a follow-up scheduled and belong to the user
    const q = query(
      clientsRef, 
      where('salesAgentId', '==', user.uid),
      where('nextFollowUpDate', '>', 0)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const now = Date.now();
      const clients = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Client));
      
      const dueClient = clients.find(c => c.nextFollowUpDate && Math.abs(c.nextFollowUpDate - now) < 60000);
      if (dueClient && (!activeAlarm || activeAlarm.id !== dueClient.id)) {
        setActiveAlarm(dueClient);
      } else if (!dueClient) {
        setActiveAlarm(null);
      }

      const overdue = clients.some(c => c.nextFollowUpDate && c.nextFollowUpDate < (now - 60000));
      setHasOverdueTasks(overdue);
    }, (err) => {
      console.error("AlarmManager Clients Snapshot Error:", err);
    });
    return () => unsubscribe();
  }, [user, activeAlarm]);

  useEffect(() => {
    if (!ringtoneRef.current) {
      ringtoneRef.current = new Audio('https://assets.mixkit.co/active_storage/sfx/135/135-preview.mp3');
      ringtoneRef.current.loop = true;
    }
    if (!dangerToneRef.current) {
      dangerToneRef.current = new Audio('https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3');
      dangerToneRef.current.loop = true;
      dangerToneRef.current.volume = 0.4;
    }

    if (activeAlarm && !isMuted) {
      ringtoneRef.current.play().catch(() => {});
      dangerToneRef.current.pause();
    } 
    else if (hasOverdueTasks && !dangerMuted && !isMuted) {
      dangerToneRef.current.play().catch(() => {});
      ringtoneRef.current.pause();
    } 
    else {
      ringtoneRef.current.pause();
      dangerToneRef.current.pause();
    }

    return () => {
      ringtoneRef.current?.pause();
      dangerToneRef.current?.pause();
    };
  }, [activeAlarm, hasOverdueTasks, isMuted, dangerMuted]);

  if (!activeAlarm && !hasOverdueTasks) return null;

  return (
    <div className="fixed bottom-6 left-6 z-[999] flex flex-col gap-4 max-w-sm w-full animate-fade-in">
      {activeAlarm && (
        <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-2xl border-4 border-primary-500 space-y-4 animate-bounce">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary-500 text-white rounded-2xl flex items-center justify-center shrink-0">
              <PhoneOutgoing size={24} />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-black dark:text-white">موعد مكالمة الآن!</h4>
              <p className="text-[11px] font-bold text-primary-600 truncate">{activeAlarm.name}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setActiveAlarm(null); navigate(`/clients/${activeAlarm.id}`); }} className="flex-1 py-3 bg-primary-500 text-white rounded-xl text-[10px] font-black">فتح العميل</button>
            <button onClick={() => setIsMuted(true)} className="px-4 py-3 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-xl"><VolumeX size={16}/></button>
          </div>
        </div>
      )}

      {hasOverdueTasks && !dangerMuted && (
        <div className="bg-rose-500 text-white rounded-[2rem] p-6 shadow-2xl space-y-4 border-2 border-white/20">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center animate-pulse">
              <AlertTriangle size={20} />
            </div>
            <div className="flex-1">
              <h4 className="text-xs font-black">تنبيه: يوجد مهام متأخرة!</h4>
              <p className="text-[10px] opacity-80 font-bold">يرجى تصفية جدول المتابعات فوراً</p>
            </div>
            <button onClick={() => setDangerMuted(true)} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
              <X size={18} />
            </button>
          </div>
          <button onClick={() => { setDangerMuted(true); navigate('/notifications'); }} className="w-full py-3 bg-white text-rose-500 rounded-xl text-[10px] font-black uppercase">انتقل لجدول المهام</button>
        </div>
      )}
    </div>
  );
};

const Layout: React.FC = () => {
  const { user, effectiveRole, setEffectiveRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDark, setIsDark] = useState(true); 
  const [liveNotification, setLiveNotification] = useState<string | null>(null);

  useEffect(() => {
    if (effectiveRole === UserRole.TEAM_LEADER || effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER) {
      const q = query(collection(db, 'logs'), where('action', '==', 'بدء مكالمة'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const data = change.doc.data();
            const now = Date.now();
            if (now - data.timestamp < 10000) {
              setLiveNotification(`الموظف ${data.userName} بدأ مكالمة مع ${data.targetName}`);
              setTimeout(() => setLiveNotification(null), 5000);
            }
          }
        });
      }, (err) => {
        console.error("Layout Logs Snapshot Error:", err);
      });
      return () => unsubscribe();
    }
  }, [effectiveRole]);

  useEffect(() => {
    const theme = localStorage.getItem('theme');
    if (theme === 'light') {
      setIsDark(false);
      document.documentElement.classList.remove('dark');
    } else {
      setIsDark(true);
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  }, []);

  const toggleTheme = () => {
    if (isDark) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
    setIsDark(!isDark);
  };

  const navItems = [
    { name: 'لوحة التحكم', path: '/', icon: LayoutDashboard },
    { name: 'العملاء', path: '/clients', icon: Users },
    { name: 'المتابعات والمهام', path: '/notifications', icon: Bell },
    { name: 'التقارير', path: '/reports', icon: BarChart3 },
  ];

  if (effectiveRole !== UserRole.SALES_AGENT) {
    navItems.push({ name: 'خدماتنا', path: '/services', icon: BookOpen });
    navItems.push({ name: 'التصنيفات (Labels)', path: '/labels', icon: Tag });
    navItems.push({ name: 'سجل النشاطات', path: '/activity', icon: ClipboardList });
  }

  // الترتيب المطلوب: الدعوات ثم الإدارة
  if (effectiveRole !== UserRole.SALES_AGENT) {
    navItems.push({ name: 'نظام الدعوات', path: '/invites', icon: UserPlus });
    navItems.push({ name: 'النسخ الاحتياطي', path: '/backup', icon: Database });
  }
  if (user?.role === UserRole.ADMIN) {
    navItems.push({ name: 'إدارة الفريق', path: '/admin', icon: UserCog });
  }

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
      <AlarmManager user={user} />
      
      <header className="lg:hidden flex items-center justify-between p-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 sticky top-0 z-50">
        <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-slate-600 dark:text-slate-300">
          <Menu size={24} />
        </button>
        <div className="text-center">
          <h1 className="text-sm font-black text-slate-950 dark:text-white uppercase tracking-tighter">SABER GROUP</h1>
        </div>
        <div className="w-10 h-10 bg-primary-500 rounded-xl flex items-center justify-center text-white font-black text-xs">
          {user?.name?.[0] || '?'}
        </div>
      </header>

      <nav className="lg:hidden flex overflow-x-auto no-scrollbar bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 p-2 gap-2 sticky top-[65px] z-40">
        {navItems.map((item) => (
          <Link 
            key={item.path} 
            to={item.path} 
            className={`flex items-center px-4 py-2 text-[10px] font-black rounded-xl whitespace-nowrap transition-all ${location.pathname === item.path ? 'bg-primary-500 text-white shadow-lg' : 'text-slate-500 bg-slate-50 dark:bg-slate-800'}`}
          >
            <item.icon className="ml-2" size={14} /> {item.name}
          </Link>
        ))}
      </nav>

      {liveNotification && (
        <div className="fixed top-20 lg:top-6 left-1/2 -translate-x-1/2 z-[1000] bg-white dark:bg-slate-900 px-6 py-4 rounded-3xl shadow-2xl border-2 border-primary-500 animate-fade-in flex items-center gap-4 w-[90%] max-w-md">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse shrink-0"></div>
          <span className="font-black text-[10px] lg:text-sm">{liveNotification}</span>
        </div>
      )}

      {isSidebarOpen && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-[60] lg:hidden" onClick={() => setIsSidebarOpen(false)}></div>
      )}

      <aside className={`fixed inset-y-0 right-0 z-[70] w-72 bg-white dark:bg-slate-900 border-l border-slate-100 dark:border-slate-800 transition-transform lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex flex-col h-full p-8">
          <div className="flex justify-between items-center mb-12 text-right">
            <div>
              <h1 className="text-xl font-black text-slate-950 dark:text-white uppercase tracking-tighter">SABER GROUP</h1>
              <p className="text-primary-500 font-black text-[10px] uppercase tracking-widest mt-1">CRM SYSTEM</p>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-slate-400">
              <X size={20} />
            </button>
          </div>

          <nav className="flex-1 space-y-2">
            {navItems.map((item) => (
              <Link key={item.path} to={item.path} className={`flex items-center px-4 py-4 text-sm font-black rounded-2xl transition-all ${location.pathname === item.path ? 'bg-primary-500 text-white shadow-xl shadow-primary-500/20' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                <item.icon className="ml-3" size={20} /> {item.name}
              </Link>
            ))}
          </nav>

          <div className="pt-8 space-y-4">
            {user?.role === UserRole.ADMIN && (
              <div className="p-4 bg-amber-50 dark:bg-amber-500/10 rounded-3xl border border-amber-100 dark:border-amber-500/20">
                <div className="flex items-center gap-2 mb-3 text-amber-600">
                  <Eye size={16} /> <span className="text-[10px] font-black uppercase">عرض بصلاحية:</span>
                </div>
                <select 
                  className="w-full bg-white dark:bg-slate-800 text-[10px] font-black p-2 rounded-xl outline-none"
                  value={effectiveRole || ''}
                  onChange={(e) => setEffectiveRole(e.target.value as UserRole)}
                >
                  {Object.values(UserRole).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            )}
            <button onClick={toggleTheme} className="flex items-center w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 rounded-2xl text-sm font-black text-slate-600 dark:text-slate-300">
              {isDark ? <Sun className="ml-3" size={18} /> : <Moon className="ml-3" size={18} />}
              {isDark ? 'الوضع النهاري' : 'الوضع الليلي'}
            </button>
            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700">
              <div className="flex items-center mb-4">
                <div className="w-10 h-10 bg-primary-500 rounded-2xl flex items-center justify-center text-white font-black">
                  {user?.name?.[0] || '?'}
                </div>
                <div className="mr-3 overflow-hidden">
                  {/* تم الإصلاح هنا لضمان عرض الاسم الفعلي المجلوب من Firestore */}
                  <p className="text-xs font-black truncate text-right">{user?.name || user?.email?.split('@')[0] || 'مستخدم'}</p>
                  <p className="text-[10px] text-slate-400 uppercase text-right">{effectiveRole}</p>
                </div>
              </div>
              <button onClick={() => signOut(auth)} className="flex items-center w-full px-3 py-2 text-xs font-black text-rose-500 bg-rose-50 dark:bg-rose-500/10 rounded-xl">
                <LogOut className="ml-2" size={14} /> تسجيل خروج
              </button>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden p-4 lg:p-10">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
