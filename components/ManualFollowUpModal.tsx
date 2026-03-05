
import React, { useState } from 'react';
import { X, Clock, Calendar, LayoutList, Timer, Save } from 'lucide-react';
import { Client, ClientStatus, CommMethod, StatusLabels, CommMethodLabels } from '../types';
import * as firestore from 'firebase/firestore';
import { db, logActivity } from '../firebase';

interface ManualFollowUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: Client;
  user: { uid: string; name: string };
}

const ManualFollowUpModal: React.FC<ManualFollowUpModalProps> = ({ isOpen, onClose, client, user }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }));
  const [duration, setDuration] = useState('5');
  
  const [salesBrief, setSalesBrief] = useState('');
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<ClientStatus>(client.status);
  const [method, setMethod] = useState<CommMethod>(CommMethod.PHONE);
  const [nextFollowUpMethod, setNextFollowUpMethod] = useState<CommMethod>(CommMethod.PHONE);
  
  const [scheduleNext, setScheduleNext] = useState(false);
  const [nextDate, setNextDate] = useState('');
  const [nextTime, setNextTime] = useState('10:00');
  const [nextPeriod, setNextPeriod] = useState<'AM' | 'PM'>('AM');

  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const calculateTimestamp = (d: string, t: string, p?: string) => {
    if (!d) return 0;
    const [h, m] = t.split(':').map(Number);
    let finalH = h;
    if (p) {
      finalH = p === 'PM' && h < 12 ? h + 12 : (p === 'AM' && h === 12 ? 0 : h);
    }
    const dateObj = new Date(d);
    dateObj.setHours(finalH, m, 0, 0);
    return dateObj.getTime();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const followUpTimestamp = calculateTimestamp(date, time);
      const durationMs = parseInt(duration) * 60 * 1000;
      const startTime = followUpTimestamp;
      const endTime = followUpTimestamp + durationMs;
      
      let nextTs = 0;
      if (scheduleNext && nextDate) {
        nextTs = calculateTimestamp(nextDate, nextTime, nextPeriod);
      }

      const scheduledTime = client.nextFollowUpDate || 0;
      let delayStatus: 'on_time' | 'acceptable' | 'large_delay' = 'on_time';
      
      if (scheduledTime > 0) {
        const delayMins = (startTime - scheduledTime) / (1000 * 60);
        if (delayMins > 15) delayStatus = 'large_delay';
        else if (delayMins > 5) delayStatus = 'acceptable';
      }

      await firestore.addDoc(firestore.collection(db, 'followups'), {
        clientId: client.id,
        clientName: client.name,
        agentId: user.uid,
        agentName: user.name,
        note,
        result,
        salesBrief,
        method,
        timestamp: Date.now(), // وقت تسجيل العملية
        startTime, // وقت بدء المتابعة الفعلي
        endTime, // وقت انتهاء المتابعة الفعلي
        duration: parseInt(duration) * 60, // بالثواني
        scheduledTime,
        delayStatus
      });

      const updateData: any = {
        status,
        lastFollowUpDate: followUpTimestamp
      };

      if (nextTs) {
        updateData.nextFollowUpDate = nextTs;
        updateData.nextFollowUpMethod = nextFollowUpMethod;
      }

      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), updateData);

      await logActivity(user.uid, user.name, `تسجيل متابعة خارجية: ${salesBrief}`, client.id, client.name);
      
      onClose();
    } catch (error) {
      console.error("Error saving manual follow-up:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/60 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-2xl my-8 shadow-2xl border border-slate-100 dark:border-slate-800 animate-fade-in overflow-hidden">
        <div className="p-8 border-b border-slate-50 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary-500 text-white rounded-2xl shadow-lg shadow-primary-500/20">
              <Clock size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-white">تسجيل متابعة خارجية</h2>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">توثيق تواصل تم خارج النظام</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-colors text-slate-400">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">تاريخ التواصل</label>
              <div className="relative">
                <Calendar size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="date" required className="w-full p-4 pr-10 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none border border-transparent focus:border-primary-500" value={date} onChange={e => setDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">وقت التواصل</label>
              <div className="relative">
                <Clock size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="time" required className="w-full p-4 pr-10 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none border border-transparent focus:border-primary-500" value={time} onChange={e => setTime(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">المدة (بالدقائق)</label>
              <div className="relative">
                <Timer size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="number" required min="1" className="w-full p-4 pr-10 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none border border-transparent focus:border-primary-500" value={duration} onChange={e => setDuration(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">نوع التواصل</label>
              <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none border border-transparent focus:border-primary-500" value={method} onChange={e => setMethod(e.target.value as CommMethod)}>
                {(Object.entries(CommMethodLabels) as [string, {ar: string}][]).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">موجز السيلز (الخلاصة)</label>
              <input required placeholder="مثال: تم الاتفاق على موعد تجربة" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none border border-transparent focus:border-primary-500" value={salesBrief} onChange={e => setSalesBrief(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">النتيجة التفصيلية</label>
              <textarea required placeholder="ماذا حدث في المكالمة بالتفصيل..." className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none h-24" value={result} onChange={e => setResult(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-[2rem] space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black">جدولة موعد قادم؟</label>
                <input type="checkbox" checked={scheduleNext} onChange={e => setScheduleNext(e.target.checked)} className="w-5 h-5 accent-primary-500" />
              </div>
              {scheduleNext && (
                <div className="space-y-3 animate-fade-in">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase">تاريخ المتابعة</label>
                    <input type="date" required className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs" value={nextDate} onChange={e => setNextDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase">نوع التواصل القادم</label>
                    <select className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs" value={nextFollowUpMethod} onChange={e => setNextFollowUpMethod(e.target.value as CommMethod)}>
                      {(Object.entries(CommMethodLabels) as [string, {ar: string}][]).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input type="time" required className="flex-1 p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs" value={nextTime} onChange={e => setNextTime(e.target.value)} />
                    <select className="p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs" value={nextPeriod} onChange={e => setNextPeriod(e.target.value as any)}>
                      <option value="AM">AM</option><option value="PM">PM</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">تحديث حالة العميل</label>
              <select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-[2rem] font-bold text-sm" value={status} onChange={e => setStatus(e.target.value as ClientStatus)}>
                {Object.entries(StatusLabels).map(([k,v]) => <option key={k} value={k}>{v.ar}</option>)}
              </select>
            </div>
          </div>

          <button type="submit" disabled={loading} className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:bg-primary-600 transition-all flex items-center justify-center gap-3 disabled:opacity-50">
            {loading ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <><Save size={20}/> حفظ المتابعة</>}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ManualFollowUpModal;
