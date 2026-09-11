import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as firestore from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../App';
import { useShift } from '../ShiftContext';
import { Client } from '../types';
import { X, AlertTriangle, MessageCircle, CheckCircle2, ArrowLeft } from 'lucide-react';

type Step = 'pending' | 'overdue' | 'whatsapp' | 'done';

const EndShiftModal: React.FC = () => {
  const { user } = useAuth();
  const { endShift, isEndModalOpen: isOpen, closeEndModal: onClose } = useShift();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('pending');
  const [loading, setLoading] = useState(true);
  const [pendingClients, setPendingClients] = useState<Client[]>([]);
  const [pendingFollowUpClients, setPendingFollowUpClients] = useState<Client[]>([]);
  const [overdueClients, setOverdueClients] = useState<Client[]>([]);

  useEffect(() => {
    if (!isOpen || !user) return;
    setStep('pending');
    setLoading(true);
    (async () => {
      const clientsRef = firestore.collection(db, 'clients');

      const unreviewedSnap = await firestore.getDocs(firestore.query(
        clientsRef,
        firestore.where('salesAgentId', '==', user.uid),
        firestore.where('reviewedBySales', '==', false)
      ));
      setPendingClients(unreviewedSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client)).filter(c => c.createdVia === 'ai_automation'));

      const unreviewedFollowUpSnap = await firestore.getDocs(firestore.query(
        clientsRef,
        firestore.where('salesAgentId', '==', user.uid),
        firestore.where('nextFollowUpReviewedBySales', '==', false)
      ));
      setPendingFollowUpClients(unreviewedFollowUpSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));

      const overdueSnap = await firestore.getDocs(firestore.query(
        clientsRef,
        firestore.where('salesAgentId', '==', user.uid),
        firestore.where('nextFollowUpDate', '<', Date.now()),
        firestore.where('nextFollowUpDate', '>', 0)
      ));
      setOverdueClients(overdueSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));

      setLoading(false);
    })();
  }, [isOpen, user]);

  if (!isOpen) return null;

  const totalPending = pendingClients.length + pendingFollowUpClients.length;

  const handleFinish = async () => {
    await endShift();
    onClose();
    navigate('/reports');
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6 md:p-8 space-y-5">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-black text-slate-900 dark:text-white">إنهاء الشيفت</h2>
            <button onClick={onClose} className="sg-icon-btn bg-slate-50 dark:bg-slate-800 text-slate-400"><X size={18} /></button>
          </div>

          {loading ? (
            <div className="text-center py-10 text-slate-400 font-bold text-sm animate-pulse">جاري المراجعة...</div>
          ) : step === 'pending' ? (
            totalPending > 0 ? (
              <div className="space-y-4">
                <div className="p-5 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-2xl">
                  <p className="font-black text-orange-700 dark:text-orange-400 text-sm mb-3">
                    فيه {totalPending} حاجة من الأتمتة لسه محتاجة مراجعة (Check) قبل ما تقفل الشيفت:
                  </p>
                  <ul className="space-y-2 max-h-52 overflow-y-auto">
                    {pendingClients.map(c => (
                      <li key={c.id}>
                        <button onClick={() => { onClose(); navigate(`/clients/${c.id}`); }} className="w-full text-right p-3 bg-white dark:bg-slate-800 rounded-xl text-xs font-bold flex items-center justify-between hover:ring-2 hover:ring-orange-400 transition-all">
                          <span>{c.name}</span>
                          <span className="text-[9px] font-black text-orange-500 uppercase">بيانات عميل</span>
                        </button>
                      </li>
                    ))}
                    {pendingFollowUpClients.map(c => (
                      <li key={`fu-${c.id}`}>
                        <button onClick={() => { onClose(); navigate(`/clients/${c.id}`); }} className="w-full text-right p-3 bg-white dark:bg-slate-800 rounded-xl text-xs font-bold flex items-center justify-between hover:ring-2 hover:ring-orange-400 transition-all">
                          <span>{c.name}</span>
                          <span className="text-[9px] font-black text-orange-500 uppercase">موعد متابعة</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-[11px] font-bold text-slate-400 text-center">راجعهم وارجع افتح "خلصت شغل!" تاني.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl text-center">
                  <CheckCircle2 className="mx-auto text-emerald-500 mb-2" size={26} />
                  <p className="font-black text-emerald-700 dark:text-emerald-400 text-sm">تمام، كل حاجة من الأتمتة اتراجعت</p>
                </div>
                <button onClick={() => setStep('overdue')} className="sg-btn sg-btn-primary w-full justify-center py-4">
                  التالي <ArrowLeft size={16} />
                </button>
              </div>
            )
          ) : step === 'overdue' ? (
            <div className="space-y-4">
              {overdueClients.length > 0 ? (
                <div className="p-5 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-2xl">
                  <p className="font-black text-rose-700 dark:text-rose-400 text-sm mb-3 flex items-center gap-2">
                    <AlertTriangle size={16} /> عندك {overdueClients.length} عميل كان المفروض تتابعهم ومتابعتهمش
                  </p>
                  <ul className="space-y-2 max-h-52 overflow-y-auto">
                    {overdueClients.map(c => (
                      <li key={c.id}>
                        <button onClick={() => { onClose(); navigate(`/clients/${c.id}`); }} className="w-full text-right p-3 bg-white dark:bg-slate-800 rounded-xl text-xs font-bold flex items-center justify-between hover:ring-2 hover:ring-rose-400 transition-all">
                          <span>{c.name}</span>
                          <span className="text-[9px] font-black text-rose-500">{new Date(c.nextFollowUpDate!).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="p-5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl text-center">
                  <CheckCircle2 className="mx-auto text-emerald-500 mb-2" size={26} />
                  <p className="font-black text-emerald-700 dark:text-emerald-400 text-sm">مفيش مواعيد فاتتك 🎉</p>
                </div>
              )}
              <button onClick={() => setStep('whatsapp')} className="sg-btn sg-btn-primary w-full justify-center py-4">
                التالي <ArrowLeft size={16} />
              </button>
            </div>
          ) : step === 'whatsapp' ? (
            <div className="space-y-4">
              <div className="p-5 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-2xl text-center">
                <MessageCircle className="mx-auto text-blue-500 mb-2" size={28} />
                <p className="font-black text-blue-700 dark:text-blue-400 text-sm">متنساش تسجل عملاء الواتساب!</p>
                <p className="text-[11px] font-bold text-blue-600/70 dark:text-blue-400/70 mt-1">الأتمتة بتسجل عملاء فيسبوك وانستجرام بس — الواتساب لازم تسجله إنت بنفسك.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="sg-btn sg-btn-secondary flex-1 justify-center py-4 text-xs">
                  ارجع كمّل تسجيل
                </button>
                <button onClick={handleFinish} className="sg-btn sg-btn-danger flex-1 justify-center py-4 text-xs">
                  كل العملاء اتسجلوا
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default EndShiftModal;
