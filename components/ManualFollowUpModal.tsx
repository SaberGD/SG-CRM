
import React, { useState } from 'react';
import { X, Clock, Calendar, LayoutList, Timer, Save } from 'lucide-react';
import { Client, ClientStatus, CommMethod, StatusLabels, CommMethodLabels } from '../types';
import * as firestore from 'firebase/firestore';
import { db, logActivity } from '../firebase';

import FloatingPanel from './FloatingPanel';

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
  
  // Booking States
  const [isBooked, setIsBooked] = useState(false);
  const [bookedCourseId, setBookedCourseId] = useState('');
  const [bookedCourseName, setBookedCourseName] = useState('');
  const [totalPrice, setTotalPrice] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [remainingAmount, setRemainingAmount] = useState(0);
  
  // Services for booking
  const [services, setServices] = useState<any[]>([]);
  
  const [scheduleNext, setScheduleNext] = useState(false);
  const [nextDate, setNextDate] = useState('');
  const [nextTime, setNextTime] = useState('10:00');
  const [nextPeriod, setNextPeriod] = useState<'AM' | 'PM'>('AM');

  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    const unsub = firestore.onSnapshot(firestore.collection(db, 'services'), (snap) => {
      setServices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error("ManualFollowUpModal Services Snapshot Error:", err);
    });
    return unsub;
  }, [isOpen]);

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
        status: isBooked ? ClientStatus.BOOKED : status,
        lastFollowUpDate: followUpTimestamp
      };

      if (isBooked) {
        updateData.isBooked = true;
        updateData.bookedCourseId = bookedCourseId;
        updateData.bookedCourseName = bookedCourseName;
        updateData.totalPrice = totalPrice;
        updateData.paidAmount = paidAmount;
        updateData.remainingAmount = remainingAmount;
        updateData.bookingDate = followUpTimestamp;
      }

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
    <FloatingPanel 
      isOpen={isOpen} 
      onClose={onClose} 
      title="تسجيل متابعة خارجية"
      icon={<Clock size={24} />}
    >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">تاريخ التواصل</label>
              <div className="relative">
                <Calendar size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="date" required className="w-full p-4 pr-10 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none border border-transparent focus:border-primary-500 text-slate-900 dark:text-white" value={date} onChange={e => setDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">وقت التواصل</label>
              <div className="relative">
                <Clock size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="time" required className="w-full p-4 pr-10 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none border border-transparent focus:border-primary-500 text-slate-900 dark:text-white" value={time} onChange={e => setTime(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">المدة (بالدقائق)</label>
              <div className="relative">
                <Timer size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="number" required min="1" className="w-full p-4 pr-10 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none border border-transparent focus:border-primary-500 text-slate-900 dark:text-white" value={duration} onChange={e => setDuration(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">نوع التواصل</label>
              <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none border border-transparent focus:border-primary-500 text-slate-900 dark:text-white" value={method} onChange={e => setMethod(e.target.value as CommMethod)}>
                {(Object.entries(CommMethodLabels) as [string, {ar: string}][]).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">موجز السيلز (الخلاصة)</label>
              <input required placeholder="مثال: تم الاتفاق على موعد تجربة" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none border border-transparent focus:border-primary-500 text-slate-900 dark:text-white" value={salesBrief} onChange={e => setSalesBrief(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">النتيجة التفصيلية</label>
              <textarea required placeholder="ماذا حدث في المكالمة بالتفصيل..." className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none h-40 text-slate-900 dark:text-white" value={result} onChange={e => setResult(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-[2rem] space-y-4 border border-slate-100 dark:border-slate-700/50">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black text-slate-700 dark:text-slate-300">جدولة موعد قادم؟</label>
                <input type="checkbox" checked={scheduleNext} onChange={e => setScheduleNext(e.target.checked)} className="w-5 h-5 accent-primary-500" />
              </div>
              {scheduleNext && (
                <div className="space-y-3 animate-fade-in">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase">تاريخ المتابعة</label>
                    <input type="date" required className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs text-slate-900 dark:text-white" value={nextDate} onChange={e => setNextDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase">نوع التواصل القادم</label>
                    <select className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs text-slate-900 dark:text-white" value={nextFollowUpMethod} onChange={e => setNextFollowUpMethod(e.target.value as CommMethod)}>
                      {(Object.entries(CommMethodLabels) as [string, {ar: string}][]).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input type="time" required className="flex-1 p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs text-slate-900 dark:text-white" value={nextTime} onChange={e => setNextTime(e.target.value)} />
                    <select className="p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs text-slate-900 dark:text-white" value={nextPeriod} onChange={e => setNextPeriod(e.target.value as any)}>
                      <option value="AM">AM</option><option value="PM">PM</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">تحديث حالة العميل</label>
              <select className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-[2rem] font-bold text-sm text-slate-900 dark:text-white border border-slate-100 dark:border-slate-700/50" value={status} onChange={e => setStatus(e.target.value as ClientStatus)}>
                {Object.entries(StatusLabels).map(([k,v]) => <option key={k} value={k}>{v.ar}</option>)}
              </select>
            </div>
          </div>

          {/* Booking Section */}
          <div className="p-6 bg-amber-50 dark:bg-amber-500/5 rounded-[2rem] border border-amber-200 dark:border-amber-500/20 space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-amber-700 dark:text-amber-400">هل قام العميل بالحجز في هذا التواصل؟</label>
              <input type="checkbox" checked={isBooked} onChange={e => setIsBooked(e.target.checked)} className="w-5 h-5 accent-amber-500" />
            </div>
            
            {isBooked && (
              <div className="space-y-4 animate-fade-in pt-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase">الكورس المحجوز</label>
                  <select 
                    required 
                    className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs text-slate-900 dark:text-white" 
                    value={bookedCourseId} 
                    onChange={e => {
                      const s = services.find(srv => srv.id === e.target.value);
                      setBookedCourseId(e.target.value);
                      setBookedCourseName(s?.name || '');
                    }}
                  >
                    <option value="">اختر الكورس...</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase">السعر الإجمالي</label>
                    <input 
                      type="number" 
                      required 
                      className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs text-slate-900 dark:text-white" 
                      value={totalPrice} 
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0;
                        setTotalPrice(val);
                        setRemainingAmount(val - paidAmount);
                      }} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase">المبلغ المدفوع</label>
                    <input 
                      type="number" 
                      required 
                      className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs text-slate-900 dark:text-white" 
                      value={paidAmount} 
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0;
                        setPaidAmount(val);
                        setRemainingAmount(totalPrice - val);
                      }} 
                    />
                  </div>
                </div>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-amber-100 dark:border-amber-500/10">
                  <p className="text-[9px] font-black text-slate-400 uppercase">المبلغ المتبقي</p>
                  <p className="text-sm font-black text-amber-600">{remainingAmount} ج.م</p>
                </div>
              </div>
            )}
          </div>

          <button type="submit" disabled={loading} className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:bg-primary-600 transition-all flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[0.98]">
            {loading ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <><Save size={20}/> حفظ المتابعة</>}
          </button>
        </form>
    </FloatingPanel>
  );
};

export default ManualFollowUpModal;
