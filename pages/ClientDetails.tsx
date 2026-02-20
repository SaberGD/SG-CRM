
import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as firestore from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { 
  Client, FollowUp, ClientStatus, CommMethod, StatusLabels, CommMethodLabels,
  UserRole, ActivityLog, Gender, LaptopStatus, AttendanceMode 
} from '../types';
import { 
  Play, Square, Clock, Calendar, History, PhoneIncoming, Clock4, 
  MessageSquare, Edit2, X, Save, User, CalendarPlus, 
  Download, FileText, UserCheck, Settings, Timer, LayoutList, History as HistoryIcon
} from 'lucide-react';
import ManualFollowUpModal from '../components/ManualFollowUpModal';

const ClientDetails: React.FC = () => {
  const { id } = useParams();
  const { user, effectiveRole } = useAuth();
  const navigate = useNavigate();
  
  const [client, setClient] = useState<Client | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isCommunicating, setIsCommunicating] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);

  // Form States
  const [note, setNote] = useState('');
  const [result, setResult] = useState('');
  const [salesBrief, setSalesBrief] = useState(''); // موجز السيلز
  const [method, setMethod] = useState<CommMethod>(CommMethod.PHONE);
  const [nextFollowUpMethod, setNextFollowUpMethod] = useState<CommMethod>(CommMethod.PHONE);
  const [status, setStatus] = useState<ClientStatus>(ClientStatus.INTERESTED);
  const [scheduleNext, setScheduleNext] = useState(false);
  
  // Scheduling
  const [nextDate, setNextDate] = useState('');
  const [nextTime, setNextTime] = useState('10:00');
  const [nextPeriod, setNextPeriod] = useState<'AM' | 'PM'>('AM');

  // Edit Client
  const [editClientData, setEditClientData] = useState({ 
    name: '', phone: '', serviceName: '', status: ClientStatus.INTERESTED,
    gender: Gender.MALE, laptop: LaptopStatus.WITHOUT, mode: AttendanceMode.OFFLINE
  });

  const isHighRole = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER || effectiveRole === UserRole.TEAM_LEADER;

  useEffect(() => {
    if (!id) return;

    const unsubClient = firestore.onSnapshot(firestore.doc(db, 'clients', id), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Client;
        setClient({ id: snap.id, ...data });
        setEditClientData({ 
          name: data.name, 
          phone: data.phone, 
          serviceName: data.serviceName,
          status: data.status,
          gender: data.gender || Gender.MALE,
          laptop: data.laptop || LaptopStatus.WITHOUT,
          mode: data.mode || AttendanceMode.OFFLINE
        });
        setStatus(data.status);
      }
      setLoading(false);
    });

    const unsubFollowups = firestore.onSnapshot(
      firestore.query(firestore.collection(db, 'followups'), firestore.where('clientId', '==', id), firestore.orderBy('timestamp', 'desc')),
      (snap) => {
        setFollowUps(snap.docs.map(d => ({ id: d.id, ...d.data() } as FollowUp)));
      }
    );

    const unsubLogs = firestore.onSnapshot(
      firestore.query(firestore.collection(db, 'logs'), firestore.where('targetId', '==', id), firestore.orderBy('timestamp', 'desc')),
      (snap) => {
        setActivityLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ActivityLog)));
      }
    );

    return () => {
      unsubClient();
      unsubFollowups();
      unsubLogs();
    };
  }, [id]);

  useEffect(() => {
    let interval: any;
    if (isCommunicating && startTime) {
      interval = setInterval(() => setElapsedTime(Math.floor((Date.now() - startTime) / 1000)), 1000);
    }
    return () => clearInterval(interval);
  }, [isCommunicating, startTime]);

  const unifiedTimeline = useMemo(() => {
    const items = [
      ...followUps.map(f => ({ ...f, type: 'followup' as const })),
      ...activityLogs.map(l => ({ ...l, type: 'log' as const }))
    ];
    return items.sort((a, b) => b.timestamp - a.timestamp);
  }, [followUps, activityLogs]);

  const handleStartCall = async () => {
    if (!user || !client) return;
    setIsCommunicating(true);
    setStartTime(Date.now());
    await logActivity(user.uid, user.name, "بدء جلسة تواصل", client.id, client.name);
  };

  const calculateTimestamp = (d: string, t: string, p: string) => {
    if (!d) return 0;
    const [h, m] = t.split(':').map(Number);
    const finalH = p === 'PM' && h < 12 ? h + 12 : (p === 'AM' && h === 12 ? 0 : h);
    const dateObj = new Date(d);
    dateObj.setHours(finalH, m, 0, 0);
    return dateObj.getTime();
  };

  const submitFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || !user || !startTime) return;
    
    const endTime = Date.now();
    const duration = Math.floor((endTime - startTime) / 1000);
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

    try {
      await firestore.addDoc(firestore.collection(db, 'followups'), {
        clientId: client.id, clientName: client.name,
        agentId: user.uid, agentName: user.name,
        note, result, salesBrief, method,
        timestamp: Date.now(), startTime, endTime, duration,
        scheduledTime,
        delayStatus
      });
      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), { 
        status, 
        nextFollowUpDate: nextTs || client.nextFollowUpDate, 
        nextFollowUpMethod: nextTs ? nextFollowUpMethod : client.nextFollowUpMethod,
        lastFollowUpDate: Date.now() 
      });
      
      await logActivity(user.uid, user.name, `إنهاء متابعة: ${salesBrief}`, client.id, client.name);
      
      setShowForm(false);
      setNote(''); setResult(''); setSalesBrief('');
      setIsCommunicating(false);
      setStartTime(null);
      setElapsedTime(0);
    } catch (err) { console.error(err); }
  };

  const handleUpdateClient = async () => {
    if (!client || !user) return;
    try {
      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), editClientData);
      await logActivity(user.uid, user.name, `تحديث بيانات العميل`, client.id, client.name);
      setIsEditModalOpen(false);
    } catch (err) { console.error(err); }
  };

  if (loading) return <div className="text-center py-40 animate-pulse font-black text-primary-500">جاري تحميل السجل...</div>;
  if (!client) return <div className="text-center py-40">العميل غير موجود</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in pb-20">
      <header className="bg-white dark:bg-slate-900 p-8 rounded-[3.5rem] shadow-xl border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 bg-primary-500 text-white rounded-[2.5rem] flex items-center justify-center text-3xl font-black">{client.name[0]}</div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-black text-slate-900 dark:text-white">{client.name}</h1>
              <button onClick={() => setIsEditModalOpen(true)} className="p-2 bg-slate-50 dark:bg-slate-800 rounded-xl text-slate-400 hover:text-primary-500"><Edit2 size={16}/></button>
            </div>
            <p className="text-primary-500 font-bold flex items-center gap-2 mt-1"><PhoneIncoming size={14}/> {client.phone}</p>
            <div className="flex gap-2 mt-3">
              <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-3 py-1 rounded-full text-[9px] font-black">{client.gender === Gender.MALE ? 'ذكر' : 'أنثى'}</span>
              <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-3 py-1 rounded-full text-[9px] font-black">{client.laptop === LaptopStatus.WITH ? 'لابتوب' : 'بدون لابتوب'}</span>
              <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-3 py-1 rounded-full text-[9px] font-black">{client.mode === AttendanceMode.ONLINE ? 'أونلاين' : 'أوفلاين'}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
           {!isCommunicating && !showForm && (
            <>
              <button onClick={handleStartCall} className="bg-primary-500 text-white px-10 py-4 rounded-2xl font-black shadow-xl flex items-center gap-3 text-xs uppercase hover:bg-primary-600 transition-all">
                <Play size={18} /> بدء المتابعة
              </button>
              <button onClick={() => setIsManualModalOpen(true)} className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-6 py-4 rounded-2xl font-black shadow-sm flex items-center gap-3 text-xs uppercase hover:bg-slate-200 dark:hover:bg-slate-700 transition-all border border-slate-200 dark:border-slate-700">
                <HistoryIcon size={18} /> تم التواصل مسبقاً
              </button>
            </>
          )}
          {isCommunicating && (
            <button onClick={() => { setIsCommunicating(false); setShowForm(true); }} className="bg-rose-500 text-white px-10 py-4 rounded-2xl font-black shadow-xl flex items-center gap-3 text-xs uppercase animate-pulse">
              <Square size={18} /> إنهاء وتسجيل
            </button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-slate-100 dark:border-slate-800 flex items-center gap-5">
           <div className="w-14 h-14 bg-blue-50 dark:bg-blue-500/10 text-blue-500 rounded-2xl flex items-center justify-center"><Clock size={28}/></div>
           <div><p className="text-[10px] font-black text-slate-400 uppercase">وقت التسجيل في النظام</p><p className="text-xs font-black">{new Date(client.createdAt).toLocaleString('ar-EG')}</p></div>
        </div>
        <div className={`p-8 rounded-[2.5rem] shadow-xl text-center flex flex-col items-center justify-center ${client.nextFollowUpDate && client.nextFollowUpDate < Date.now() ? 'bg-rose-500 text-white' : 'bg-primary-500 text-white'}`}>
           <p className="text-[10px] font-black uppercase opacity-80 mb-2">الموعد المجدول القادم</p>
           <p className="text-xl font-black">{client.nextFollowUpDate ? new Date(client.nextFollowUpDate).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'غير محدد'}</p>
           {client.nextFollowUpDate && client.nextFollowUpMethod && (
             <p className="text-[10px] font-black mt-1 bg-white/20 px-3 py-1 rounded-full">{CommMethodLabels[client.nextFollowUpMethod].ar}</p>
           )}
        </div>
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-slate-100 dark:border-slate-800 flex items-center gap-5">
           <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500 rounded-2xl flex items-center justify-center"><UserCheck size={28}/></div>
           <div><p className="text-[10px] font-black text-slate-400 uppercase">الحالة الحالية</p><p className="text-xs font-black">{StatusLabels[client.status].ar}</p></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-2xl font-black flex items-center gap-3"><History className="text-primary-500" /> التايم لاين (سجل التواصل)</h2>
          <div className="relative border-r-2 border-slate-100 dark:border-slate-800 pr-8 space-y-8">
            {unifiedTimeline.map((item: any) => (
              <div key={item.id} className="relative">
                <div className={`absolute -right-[41px] top-1 w-5 h-5 rounded-full border-4 border-white dark:border-slate-950 ${item.type === 'followup' ? 'bg-primary-500' : 'bg-slate-300'}`}></div>
                <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm">
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-[10px] font-black text-slate-400 bg-slate-50 dark:bg-slate-800 px-3 py-1 rounded-full">{new Date(item.timestamp).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="text-[9px] font-black uppercase text-primary-500">{item.type === 'followup' ? 'متابعة سيلز' : 'تحديث نظام'}</span>
                  </div>
                  {item.type === 'followup' ? (
                    <div className="space-y-3">
                       <div className="flex gap-2">
                         <span className="text-[9px] font-black bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                           {CommMethodLabels[item.method as CommMethod]?.ar || item.method}
                         </span>
                       </div>
                       <div className="p-3 bg-primary-50 dark:bg-primary-500/5 rounded-xl border border-primary-100 dark:border-primary-500/10">
                          <p className="text-[9px] font-black text-primary-500 uppercase mb-1">موجز السيلز (الخلاصة)</p>
                          <p className="text-sm font-black text-slate-900 dark:text-white">{item.salesBrief}</p>
                       </div>
                       <p className="text-xs text-slate-500 dark:text-slate-400 font-bold leading-relaxed">النتيجة: {item.result}</p>
                       <p className="text-[11px] text-slate-400 italic">ملاحظات: {item.note}</p>
                    </div>
                  ) : (
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{item.action}</p>
                  )}
                  <div className="mt-4 pt-3 border-t border-slate-50 dark:border-slate-800 text-[9px] font-black text-slate-400">بواسطة: {item.type === 'followup' ? item.agentName : item.userName}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside>
          {showForm ? (
            <div className="bg-white dark:bg-slate-900 p-8 rounded-[3.5rem] shadow-2xl border-2 border-primary-500/30 sticky top-10 animate-fade-in">
              <h3 className="text-xl font-black mb-6 flex items-center gap-2"><LayoutList className="text-primary-500"/> توثيق المتابعة</h3>
              <form onSubmit={submitFollowUp} className="space-y-5">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">نوع التواصل الحالي</label>
                  <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white" value={method} onChange={e => setMethod(e.target.value as CommMethod)}>
                    {(Object.entries(CommMethodLabels) as [string, {ar: string}][]).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">موجز السيلز (خلاصة سريعة لما تم الوصول إليه)</label>
                  <input required placeholder="مثال: مهتم بالعرض ويريد تفاصيل الحجز" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none border border-transparent focus:border-primary-500" value={salesBrief} onChange={e => setSalesBrief(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">النتيجة التفصيلية</label>
                  <input required placeholder="سجل الرد النهائي للعميل..." className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none" value={result} onChange={e => setResult(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">ملاحظات داخلية</label>
                  <textarea placeholder="أي ملاحظات فنية إضافية..." className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white outline-none h-24" value={note} onChange={e => setNote(e.target.value)} />
                </div>
                
                <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl space-y-3">
                   <div className="flex items-center justify-between">
                      <label className="text-[11px] font-black">تحديد موعد تواصل جديد؟</label>
                      <input type="checkbox" checked={scheduleNext} onChange={e => setScheduleNext(e.target.checked)} className="w-5 h-5 accent-primary-500" />
                   </div>
                   {scheduleNext && (
                      <div className="space-y-3 animate-fade-in pt-2">
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">تاريخ المتابعة</label>
                          <input type="date" className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs" value={nextDate} onChange={e => setNextDate(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">نوع التواصل القادم</label>
                          <select className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs" value={nextFollowUpMethod} onChange={e => setNextFollowUpMethod(e.target.value as CommMethod)}>
                            {(Object.entries(CommMethodLabels) as [string, {ar: string}][]).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <input type="time" className="flex-1 p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs" value={nextTime} onChange={e => setNextTime(e.target.value)} />
                          <select className="p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs" value={nextPeriod} onChange={e => setNextPeriod(e.target.value as any)}>
                            <option value="AM">AM</option><option value="PM">PM</option>
                          </select>
                        </div>
                      </div>
                   )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">تحديث حالة العميل</label>
                  <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm dark:text-white" value={status} onChange={e => setStatus(e.target.value as ClientStatus)}>
                    {Object.entries(StatusLabels).map(([k,v]) => <option key={k} value={k}>{v.ar}</option>)}
                  </select>
                </div>

                <button type="submit" className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:bg-primary-600 transition-all">حفظ وإتمام المتابعة</button>
              </form>
            </div>
          ) : (
            <div className="p-10 text-center bg-slate-50 dark:bg-slate-900/50 rounded-[3rem] border-2 border-dashed border-slate-200 dark:border-slate-800">
               <p className="text-xs font-black text-slate-400">سجل تواصلك مع العميل الآن لتوثيق التحركات</p>
            </div>
          )}
        </aside>
      </div>

      {/* Edit Client Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 backdrop-blur-md p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-lg p-10 space-y-6 shadow-2xl border border-slate-100 dark:border-slate-800">
             <div className="flex justify-between items-center">
               <h2 className="text-2xl font-black">تعديل الملف</h2>
               <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400"><X size={24}/></button>
             </div>
             <div className="space-y-4">
               <input className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold dark:text-white" value={editClientData.name} onChange={e => setEditClientData({...editClientData, name: e.target.value})} placeholder="الاسم" />
               <div className="grid grid-cols-3 gap-3">
                  <select className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold dark:text-white text-xs" value={editClientData.gender} onChange={e => setEditClientData({...editClientData, gender: e.target.value as Gender})}>
                    <option value={Gender.MALE}>ذكر</option><option value={Gender.FEMALE}>أنثى</option>
                  </select>
                  <select className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold dark:text-white text-xs" value={editClientData.laptop} onChange={e => setEditClientData({...editClientData, laptop: e.target.value as LaptopStatus})}>
                    <option value={LaptopStatus.WITH}>لابتوب</option><option value={LaptopStatus.WITHOUT}>بدون</option>
                  </select>
                  <select className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold dark:text-white text-xs" value={editClientData.mode} onChange={e => setEditClientData({...editClientData, mode: e.target.value as AttendanceMode})}>
                    <option value={AttendanceMode.OFFLINE}>أوفلاين</option><option value={AttendanceMode.ONLINE}>أونلاين</option>
                  </select>
               </div>
               <button onClick={handleUpdateClient} className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl">حفظ التغييرات</button>
             </div>
          </div>
        </div>
      )}

      {client && user && (
        <ManualFollowUpModal 
          isOpen={isManualModalOpen} 
          onClose={() => setIsManualModalOpen(false)} 
          client={client} 
          user={user} 
        />
      )}
    </div>
  );
};

export default ClientDetails;
