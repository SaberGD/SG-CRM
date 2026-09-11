import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as firestore from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../App';
import { useShift } from '../ShiftContext';
import { Client, DailyReport } from '../types';
import { Sparkles, CheckCircle2, Clock, PlayCircle, Eye, ArrowLeft, MessageSquare } from 'lucide-react';

const ShiftGate: React.FC = () => {
  const { user } = useAuth();
  const { startShift, isGateOpen, dismissGate } = useShift();
  const navigate = useNavigate();

  const [step, setStep] = useState<'welcome' | 'review'>('welcome');
  const [pendingClients, setPendingClients] = useState<Client[]>([]);
  const [pendingFollowUpClients, setPendingFollowUpClients] = useState<Client[]>([]);
  const [todayFollowUps, setTodayFollowUps] = useState<Client[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [starting, setStarting] = useState(false);
  const [unackedReport, setUnackedReport] = useState<DailyReport | null>(null);

  useEffect(() => {
    if (isGateOpen) setStep('welcome');
  }, [isGateOpen]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const snap = await firestore.getDocs(firestore.query(
        firestore.collection(db, 'reports'),
        firestore.where('userId', '==', user.uid),
        firestore.where('acknowledgedBySales', '==', false)
      ));
      const withReply = snap.docs.map(d => ({ id: d.id, ...d.data() } as DailyReport)).filter(r => !!r.supervisorReply);
      withReply.sort((a, b) => (b.supervisorReplyAt || 0) - (a.supervisorReplyAt || 0));
      setUnackedReport(withReply[0] || null);
    })();
  }, [user]);

  const handleAcknowledge = async () => {
    if (!unackedReport) return;
    await firestore.updateDoc(firestore.doc(db, 'reports', unackedReport.id), {
      acknowledgedBySales: true,
      acknowledgedAt: Date.now(),
    });
    setUnackedReport(null);
  };

  useEffect(() => {
    if (!user || step !== 'review') return;
    setLoadingData(true);
    (async () => {
      const clientsRef = firestore.collection(db, 'clients');

      const unreviewedSnap = await firestore.getDocs(firestore.query(
        clientsRef,
        firestore.where('salesAgentId', '==', user.uid),
        firestore.where('reviewedBySales', '==', false)
      ));
      const unreviewed = unreviewedSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client));
      setPendingClients(unreviewed.filter(c => c.createdVia === 'ai_automation'));

      const unreviewedFollowUpSnap = await firestore.getDocs(firestore.query(
        clientsRef,
        firestore.where('salesAgentId', '==', user.uid),
        firestore.where('nextFollowUpReviewedBySales', '==', false)
      ));
      setPendingFollowUpClients(unreviewedFollowUpSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));

      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
      const todaySnap = await firestore.getDocs(firestore.query(
        clientsRef,
        firestore.where('salesAgentId', '==', user.uid),
        firestore.where('nextFollowUpDate', '>=', startOfDay.getTime()),
        firestore.where('nextFollowUpDate', '<=', endOfDay.getTime())
      ));
      const todayList = todaySnap.docs.map(d => ({ id: d.id, ...d.data() } as Client)).sort((a, b) => (a.nextFollowUpDate || 0) - (b.nextFollowUpDate || 0));
      setTodayFollowUps(todayList);

      setLoadingData(false);
    })();
  }, [user, step]);

  if (!isGateOpen) return null;

  const handleStart = async () => {
    setStarting(true);
    await startShift();
    setStarting(false);
  };

  const totalPending = pendingClients.length + pendingFollowUpClients.length;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {step === 'welcome' ? (
          <div className="p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-primary-500 text-white rounded-2xl flex items-center justify-center text-2xl font-black mx-auto">
              {user?.name?.[0] || '?'}
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 dark:text-white">أهلاً بيك يا {user?.name}، مرة تانية! 👋</h1>
              <p className="text-slate-400 font-bold text-sm mt-2">هنعمل ايه النهاردة؟</p>
            </div>
            {unackedReport && (
              <div className="p-4 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 rounded-2xl text-right space-y-2">
                <p className="text-[10px] font-black text-indigo-500 uppercase flex items-center gap-1.5">
                  <MessageSquare size={12} /> رد السوبرفايزر على تقرير {unackedReport.date}
                </p>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{unackedReport.supervisorReply}</p>
                <button onClick={handleAcknowledge} className="w-full py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-[10px] font-black">
                  تمام، استلمت ✓
                </button>
              </div>
            )}
            <div className="flex flex-col gap-3 max-w-xs mx-auto">
              <button
                onClick={() => setStep('review')}
                className="sg-btn sg-btn-primary py-4 justify-center text-sm"
              >
                <PlayCircle size={18} /> يلا نبدأ شغل!
              </button>
              <button
                onClick={dismissGate}
                className="sg-btn sg-btn-secondary py-4 justify-center text-sm"
              >
                <Eye size={18} /> داخل ألقي نظرة سريعة
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 md:p-8 space-y-5">
            <div className="text-center">
              <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center justify-center gap-2">
                <Sparkles className="text-orange-500" size={22} /> قبل ما تبدأ، راجع شغل الأتمتة
              </h2>
              <p className="text-slate-400 font-bold text-xs mt-1">لازم تراجع وتأكد على البيانات دي الأول عشان نبدأ الشيفت رسمياً</p>
            </div>

            {loadingData ? (
              <div className="text-center py-10 text-slate-400 font-bold text-sm animate-pulse">جاري تجميع بياناتك...</div>
            ) : (
              <div className="space-y-4">
                {totalPending > 0 ? (
                  <div className="p-5 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-2xl">
                    <p className="font-black text-orange-700 dark:text-orange-400 text-sm mb-3">
                      عندك {totalPending} حاجة محتاجة مراجعة (Check) قبل البداية:
                    </p>
                    <ul className="space-y-2 max-h-52 overflow-y-auto">
                      {pendingClients.map(c => (
                        <li key={c.id}>
                          <button onClick={() => navigate(`/clients/${c.id}`)} className="w-full text-right p-3 bg-white dark:bg-slate-800 rounded-xl text-xs font-bold flex items-center justify-between hover:ring-2 hover:ring-orange-400 transition-all">
                            <span>{c.name}</span>
                            <span className="text-[9px] font-black text-orange-500 uppercase">بيانات عميل جديد</span>
                          </button>
                        </li>
                      ))}
                      {pendingFollowUpClients.map(c => (
                        <li key={`fu-${c.id}`}>
                          <button onClick={() => navigate(`/clients/${c.id}`)} className="w-full text-right p-3 bg-white dark:bg-slate-800 rounded-xl text-xs font-bold flex items-center justify-between hover:ring-2 hover:ring-orange-400 transition-all">
                            <span>{c.name}</span>
                            <span className="text-[9px] font-black text-orange-500 uppercase">موعد متابعة مقترح</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10px] font-bold text-orange-600/70 dark:text-orange-400/70 mt-3">افتح كل واحدة، أكّد أو عدّل، وارجع هنا تكمل.</p>
                  </div>
                ) : (
                  <div className="p-5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl text-center">
                    <CheckCircle2 className="mx-auto text-emerald-500 mb-2" size={28} />
                    <p className="font-black text-emerald-700 dark:text-emerald-400 text-sm">مفيش حاجة من الأتمتة محتاجة مراجعة دلوقتي 🎉</p>
                  </div>
                )}

                <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl">
                  <p className="font-black text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
                    <Clock size={16} className="text-primary-500" /> خلي بالك، عندك {todayFollowUps.length} متابعة النهاردة
                  </p>
                  {todayFollowUps[0] && (
                    <p className="text-xs font-bold text-slate-500 mt-1">
                      أول متابعة الساعة {new Date(todayFollowUps[0].nextFollowUpDate!).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })} — متنساش!
                    </p>
                  )}
                </div>

                <button
                  onClick={handleStart}
                  disabled={starting || totalPending > 0}
                  className={`w-full py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all ${totalPending > 0 ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed' : 'bg-primary-500 hover:bg-primary-600 text-white shadow-xl'}`}
                >
                  <CheckCircle2 size={18} /> {starting ? 'جاري البدء...' : totalPending > 0 ? `راجع الـ ${totalPending} حاجة الأول` : 'تمام، ابدأ الشيفت'}
                </button>
                <button onClick={() => setStep('welcome')} className="w-full text-center text-[11px] font-bold text-slate-400 flex items-center justify-center gap-1">
                  <ArrowLeft size={12} /> رجوع
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ShiftGate;
