
import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import MaroAssistant from './MaroAssistant';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../App';
import { auth, db, logActivity } from '../firebase';
import { signOut } from 'firebase/auth';
import { collection, query, where, onSnapshot, getDocs, getDoc, doc, getCountFromServer } from 'firebase/firestore';
import {
  LayoutDashboard, Users, Bell, BarChart3, LogOut, Menu, X, ClipboardList, Sun, Moon, BellRing, Volume2, VolumeX, BookOpen, Tag, Eye, AlertTriangle, PhoneOutgoing, UserPlus, UserCog, Database, Sparkles, Copy, CalendarCheck, Search } from 'lucide-react';
import { UserRole, Client, User } from '../types';
import ShiftGate from './ShiftGate';
import ShiftWidget from './ShiftWidget';
import EndShiftModal from './EndShiftModal';
import ErrorBoundary from './ErrorBoundary';
import { useStaff } from '../utils/refData';
import { LoadingState } from './ui';

const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.ADMIN]: 'أدمن',
  [UserRole.SUPERVISOR]: 'مشرف',
  [UserRole.MANAGER]: 'مدير',
  [UserRole.TEAM_LEADER]: 'تيم ليدر',
  [UserRole.SALES_AGENT]: 'سيلز',
};

const AlarmManager: React.FC<{ user: any }> = ({ user }) => {
  const [activeAlarm, setActiveAlarm] = useState<Client | null>(null);
  const [hasOverdueTasks, setHasOverdueTasks] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [dangerMuted, setDangerMuted] = useState(false);
  
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const dangerToneRef = useRef<HTMLAudioElement | null>(null);
  const navigate = useNavigate();

  // Follow-up alarm. Reads stay small: a live listener on TODAY's follow-ups only (instead of
  // every scheduled client, re-subscribed on each alarm change), a clock that checks them
  // every 20 seconds, and a server-side count for "is anything overdue".
  const todayDueRef = useRef<Client[]>([]);
  useEffect(() => {
    if (!user) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const q = query(collection(db, 'clients'), where('salesAgentId', '==', user.uid),
      where('nextFollowUpDate', '>=', start.getTime()), where('nextFollowUpDate', '<=', end.getTime()));
    const check = () => {
      const now = Date.now();
      // The automatic 2-week check-in of booked clients is a day-level task (shown in the lists), not a ringing appointment.
      const due = todayDueRef.current.find(c => c.nextFollowUpDate && c.nextFollowUpSetVia !== 'auto_booked' && Math.abs(c.nextFollowUpDate - now) < 60000);
      setActiveAlarm(prev => (due ? (prev?.id === due.id ? prev : due) : null));
    };
    const refreshOverdue = () => getCountFromServer(query(collection(db, 'clients'), where('salesAgentId', '==', user.uid),
      where('nextFollowUpDate', '>', 0), where('nextFollowUpDate', '<', Date.now() - 60000)))
      .then(r => setHasOverdueTasks(r.data().count > 0)).catch(() => {});
    const unsubscribe = onSnapshot(q, (snapshot) => {
      todayDueRef.current = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Client));
      check();
      refreshOverdue();
    }, (err) => {
      console.error("AlarmManager Clients Snapshot Error:", err);
    });
    const tick = window.setInterval(check, 20000);
    const overdueTick = window.setInterval(refreshOverdue, 5 * 60000);
    return () => { unsubscribe(); window.clearInterval(tick); window.clearInterval(overdueTick); };
  }, [user?.uid]);

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
    <div className="sg-crm-alarms" aria-live="assertive">
      {activeAlarm && (
        <div className="sg-crm-alarm is-call">
          <div className="sg-crm-alarm-head">
            <span className="sg-crm-alarm-icon"><PhoneOutgoing size={20} /></span>
            <div>
              <strong>موعد مكالمة الآن</strong>
              <p>{activeAlarm.name}</p>
            </div>
          </div>
          <div className="sg-crm-alarm-actions">
            <button type="button" className="sgui-button is-primary" onClick={() => { setActiveAlarm(null); navigate(`/clients/${activeAlarm.id}`); }}>فتح العميل</button>
            <button type="button" className="sgui-button" onClick={() => setIsMuted(true)} aria-label="كتم الصوت"><VolumeX size={16} /></button>
          </div>
        </div>
      )}

      {hasOverdueTasks && !dangerMuted && (
        <div className="sg-crm-alarm is-overdue">
          <div className="sg-crm-alarm-head">
            <span className="sg-crm-alarm-icon"><AlertTriangle size={20} /></span>
            <div>
              <strong>فيه متابعات متأخرة</strong>
              <p>صفّي جدول المتابعات الأول</p>
            </div>
            <button type="button" className="sg-crm-alarm-close" onClick={() => setDangerMuted(true)} aria-label="إخفاء"><X size={16} /></button>
          </div>
          <button type="button" className="sgui-button" onClick={() => { setDangerMuted(true); navigate('/notifications'); }}>افتح جدول المهام</button>
        </div>
      )}
    </div>
  );
};

const Layout: React.FC = () => {
  const { user, effectiveRole, setEffectiveRole, viewingAsUser, setViewingAsUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // The assistant stays hidden until an admin turns it on (app_settings/assistant.enabled).
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'app_settings', 'assistant')).then((s) => setAssistantEnabled(s.exists() && s.data()?.enabled === true)).catch(() => setAssistantEnabled(false));
  }, [user?.uid]);
  const [isDark, setIsDark] = useState(true);
  const [liveNotification, setLiveNotification] = useState<string | null>(null);
  // Sales agents for the admin "view as" menu, from the shared staff store (no extra read).
  const staff = useStaff();
  const viewableAgents = useMemo(() => (user?.role === UserRole.ADMIN
    ? staff.filter(a => a.role === UserRole.SALES_AGENT && !a.isDeactivated).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'))
    : []), [staff, user?.role]);

  useEffect(() => {
    if (effectiveRole === UserRole.TEAM_LEADER || effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER) {
      // Only calls started from now on (it used to read every "call started" log ever).
      const q = query(collection(db, 'logs'), where('action', '==', 'بدء مكالمة'), where('timestamp', '>=', Date.now() - 10000));
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
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const setTheme = (dark: boolean) => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
    setIsDark(dark);
  };

  // Header search (same as the accounting header): jumps to the clients list with the query.
  const [globalSearch, setGlobalSearch] = useState('');
  const globalSearchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== '/' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      e.preventDefault();
      globalSearchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sidebar grouped into sections (same idea as the accounting and training systems).
  type NavItem = { name: string; path: string; icon: any; group: string };
  const navItems: NavItem[] = [
    { name: 'لوحة التحكم', path: '/', icon: LayoutDashboard, group: 'العمل اليومي' },
    { name: 'شغل النهارده', path: '/today', icon: CalendarCheck, group: 'العمل اليومي' },
    { name: 'العملاء', path: '/clients', icon: Users, group: 'العمل اليومي' },
    { name: 'المتابعات والمهام', path: '/notifications', icon: Bell, group: 'العمل اليومي' },
    { name: 'التقارير', path: '/reports', icon: BarChart3, group: 'التقارير والذكاء' },
    ...(user?.role === UserRole.ADMIN ? [{ name: 'المساعد الذكي (مارو) AI', path: '/ai-assistant', icon: Sparkles, group: 'التقارير والذكاء' }] : []),
  ];

  if (effectiveRole !== UserRole.SALES_AGENT) {
    navItems.push({ name: 'خدماتنا', path: '/services', icon: BookOpen, group: 'الإعدادات' });
    navItems.push({ name: 'التصنيفات (Labels)', path: '/labels', icon: Tag, group: 'الإعدادات' });
    navItems.push({ name: 'سجل النشاطات', path: '/activity', icon: ClipboardList, group: 'الإدارة' });
    navItems.push({ name: 'نظام الدعوات', path: '/invites', icon: UserPlus, group: 'الإدارة' });
    if (effectiveRole === UserRole.ADMIN) navItems.push({ name: 'العملاء المكررين', path: '/duplicates', icon: Copy, group: 'الإدارة' });
    navItems.push({ name: 'النسخ الاحتياطي', path: '/backup', icon: Database, group: 'الإدارة' });
  }
  if (user?.role === UserRole.ADMIN) {
    navItems.push({ name: 'إدارة الفريق', path: '/admin', icon: UserCog, group: 'الإدارة' });
  }

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  const sections = navItems.reduce<{ title: string; items: NavItem[] }[]>((acc, item) => {
    const last = acc[acc.length - 1];
    if (last && last.title === item.group) last.items.push(item);
    else acc.push({ title: item.group, items: [item] });
    return acc;
  }, []);
  const isActivePath = (path: string) => (path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(`${path}/`));
  const currentPage = location.pathname.startsWith('/clients/') ? 'ملف العميل' : (navItems.find(i => isActivePath(i.path))?.name || 'مساحة العمل');
  const displayName = user?.name || user?.email?.split('@')[0] || 'مستخدم';

  return (
    <div className="sg-crm-shell" dir="rtl">
      <ErrorBoundary name="Alarm" silent><AlarmManager user={user} /></ErrorBoundary>
      <ErrorBoundary name="ShiftGate" silent><ShiftGate /></ErrorBoundary>
      <ErrorBoundary name="EndShift" silent><EndShiftModal /></ErrorBoundary>

      {liveNotification && (
        <div className="sg-crm-toast animate-fade-in" role="status"><i aria-hidden="true"></i><span>{liveNotification}</span></div>
      )}

      {isSidebarOpen && <div className="sg-crm-backdrop lg:hidden" onClick={() => setIsSidebarOpen(false)}></div>}

      <aside id="crm-navigation" className="sg-crm-sidebar" data-open={isSidebarOpen} aria-label="قائمة النظام">
        <div className="sg-crm-brand">
          <div>
            <img src="/saber-group-logo.png" alt="Saber Group" />
            <span>نظام المبيعات CRM</span>
          </div>
          <button type="button" onClick={() => setIsSidebarOpen(false)} className="sg-crm-menu-button" aria-label="إغلاق القائمة">
            <X size={18} />
          </button>
        </div>

        <nav className="sg-crm-nav">
          {sections.map(section => (
            <div key={section.title}>
              <h3 className="sg-crm-nav-section">{section.title}</h3>
              {section.items.map(item => (
                <Link key={item.path} to={item.path} className={`sg-crm-nav-item ${isActivePath(item.path) ? 'is-active' : ''}`} aria-current={isActivePath(item.path) ? 'page' : undefined}>
                  <item.icon size={19} aria-hidden="true" />
                  <span>{item.name}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sg-crm-sidebar-footer">
          <div className="sg-crm-user">
            <div className="sg-crm-avatar">{displayName[0]}</div>
            <div className="min-w-0">
              <strong>{displayName}</strong>
              <small>{ROLE_LABELS[effectiveRole as UserRole] || effectiveRole}</small>
            </div>
          </div>
          <button type="button" onClick={() => signOut(auth)} className="sg-crm-logout">
            <LogOut size={18} aria-hidden="true" /> <span>تسجيل خروج</span>
          </button>
        </div>
      </aside>

      <div className="sg-crm-main">
        {viewingAsUser && (
          <div className="sg-crm-view-banner">
            <Eye size={15} aria-hidden="true" />
            <span>بتشوف السيستم دلوقتي بعين: {viewingAsUser.name}</span>
            <button type="button" onClick={() => setViewingAsUser(null)}>رجوع لحسابك</button>
          </div>
        )}
        <header className="sg-crm-header">
          <div>
            <button type="button" onClick={() => setIsSidebarOpen(true)} className="sg-crm-menu-button" aria-label="فتح القائمة" aria-controls="crm-navigation" aria-expanded={isSidebarOpen}>
              <Menu size={20} />
            </button>
            <form
              role="search"
              className="sg-crm-search"
              onSubmit={(e) => {
                e.preventDefault();
                const q = globalSearch.trim();
                if (!q) return;
                navigate(`/clients?q=${encodeURIComponent(q)}`);
                setGlobalSearch('');
                globalSearchRef.current?.blur();
              }}
            >
              <Search size={16} aria-hidden="true" />
              <input ref={globalSearchRef} value={globalSearch} onChange={(e) => setGlobalSearch(e.target.value)} placeholder="ابحث عن عميل بالاسم أو الرقم..." aria-label="بحث عن عميل" />
              <kbd>/</kbd>
            </form>
            <div className="sg-crm-current-page"><span>مساحة العمل</span><strong>{currentPage}</strong></div>
          </div>
          <div>
            {user?.role === UserRole.ADMIN && (
              <details className="sgui-action-menu sg-crm-view-menu">
                <summary aria-label="عرض بصلاحية"><Eye size={16} aria-hidden="true" /><span className="hidden md:inline">عرض بصلاحية</span></summary>
                <div>
                  <label htmlFor="crm-view-role">الصلاحية</label>
                  <select id="crm-view-role" value={effectiveRole || ''} onChange={(e) => setEffectiveRole(e.target.value as UserRole)} disabled={!!viewingAsUser}>
                    {Object.values(UserRole).map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                  </select>
                  <label htmlFor="crm-view-agent">سيلز معيّن</label>
                  <select id="crm-view-agent" value={viewingAsUser?.uid || ''} onChange={(e) => setViewingAsUser(viewableAgents.find(a => a.uid === e.target.value) || null)}>
                    <option value="">بدون — حسابك أنت</option>
                    {viewableAgents.map(a => <option key={a.uid} value={a.uid}>{a.name}</option>)}
                  </select>
                </div>
              </details>
            )}
            <div className="sg-crm-theme-switch" role="group" aria-label="اختيار المظهر">
              <button type="button" className={!isDark ? 'is-active' : ''} onClick={() => setTheme(false)} aria-pressed={!isDark} aria-label="الوضع الفاتح" title="الوضع الفاتح"><Sun size={16} /></button>
              <button type="button" className={isDark ? 'is-active' : ''} onClick={() => setTheme(true)} aria-pressed={isDark} aria-label="الوضع الداكن" title="الوضع الداكن"><Moon size={16} /></button>
            </div>
          </div>
        </header>

        <main className="sg-crm-content">
          <div>
            <ErrorBoundary name="ShiftWidget" silent><ShiftWidget /></ErrorBoundary>
            <ErrorBoundary name={location.pathname} key={location.pathname}><Suspense fallback={<LoadingState />}><Outlet /></Suspense></ErrorBoundary>
          </div>
        </main>
      </div>
      {user && assistantEnabled && <MaroAssistant />}
    </div>
  );
};

export default Layout;
