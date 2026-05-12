
import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as firestore from 'firebase/firestore';
import { db, logActivity, cleanPhoneNumber } from '../firebase';
import { useAuth } from '../App';
import { 
  Client, FollowUp, ClientStatus, CommMethod, StatusLabels, CommMethodLabels,
  UserRole, ActivityLog, Gender, LaptopStatus, AttendanceMode, Service, Label,
  ClientSource, SourceLabels, ARAB_COUNTRIES
} from '../types';
import { 
  Play, Square, Clock, Calendar, History, PhoneIncoming, Clock4, 
  MessageSquare, Edit2, X, Save, User, CalendarPlus, 
  Download, FileText, UserCheck, Settings, Timer, LayoutList, History as HistoryIcon,
  MessageCircle, Globe, ExternalLink, ArrowRightLeft, Layers
} from 'lucide-react';
import FloatingPanel from '../components/FloatingPanel';
import ManualFollowUpModal from '../components/ManualFollowUpModal';
import ContactButtons from '../components/ContactButtons';

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

  const [activeAppointmentId, setActiveAppointmentId] = useState<string | null>(null);
  const [showCountrySelector, setShowCountrySelector] = useState(false);

  // Form States
  const [note, setNote] = useState('');
  const [result, setResult] = useState('');
  const [salesBrief, setSalesBrief] = useState(''); // موجز السيلز
  const [method, setMethod] = useState<CommMethod>(CommMethod.PHONE);
  const [nextFollowUpMethod, setNextFollowUpMethod] = useState<CommMethod>(CommMethod.PHONE);
  const [status, setStatus] = useState<ClientStatus>(ClientStatus.INTERESTED);
  const [labels, setLabels] = useState<string[]>([]);
  const [scheduleNext, setScheduleNext] = useState(false);
  
  // Booking States
  const [isBooked, setIsBooked] = useState(false);
  const [bookedCourseId, setBookedCourseId] = useState('');
  const [bookedCourseName, setBookedCourseName] = useState('');
  const [totalPrice, setTotalPrice] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [remainingAmount, setRemainingAmount] = useState(0);
  
  // Services for booking
  const [services, setServices] = useState<Service[]>([]);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  
  // Scheduling
  const [nextDate, setNextDate] = useState('');
  const [nextTime, setNextTime] = useState('10:00');
  const [nextPeriod, setNextPeriod] = useState<'AM' | 'PM'>('AM');

  // Edit Client
  const [editClientData, setEditClientData] = useState({ 
    name: '', phone: '', serviceName: '', serviceId: '', customServiceName: '', status: ClientStatus.INTERESTED,
    gender: Gender.MALE, laptop: LaptopStatus.WITHOUT, mode: AttendanceMode.OFFLINE,
    labels: [] as string[],
    source: ClientSource.WHATSAPP, profileLink: '',
    country: 'مصر', countryCode: '+20'
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
          serviceId: data.serviceId || '',
          customServiceName: data.serviceName, // simplified
          status: data.status,
          gender: data.gender || Gender.MALE,
          laptop: data.laptop || LaptopStatus.WITHOUT,
          mode: data.mode || AttendanceMode.OFFLINE,
          labels: data.labels || [],
          source: data.source || ClientSource.WHATSAPP,
          profileLink: data.profileLink || '',
          country: data.country || 'مصر',
          countryCode: data.countryCode || '+20'
        });
        setStatus(data.status);
        setLabels(data.labels || []);
      }
      setLoading(false);
    }, (err) => {
      console.error("ClientDetails Client Snapshot Error:", err);
      setLoading(false);
    });

    const unsubFollowups = firestore.onSnapshot(
      firestore.query(firestore.collection(db, 'followups'), firestore.where('clientId', '==', id), firestore.orderBy('timestamp', 'desc')),
      (snap) => {
        setFollowUps(snap.docs.map(d => ({ id: d.id, ...d.data() } as FollowUp)));
      }, (err) => {
        console.error("ClientDetails Followups Snapshot Error:", err);
      }
    );

    const unsubLogs = isHighRole ? firestore.onSnapshot(
      firestore.query(firestore.collection(db, 'logs'), firestore.where('targetId', '==', id), firestore.orderBy('timestamp', 'desc')),
      (snap) => {
        setActivityLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ActivityLog)));
      }, (err) => {
        console.error("ClientDetails Logs Snapshot Error:", err);
      }
    ) : () => {};

    const unsubServices = firestore.onSnapshot(firestore.collection(db, 'services'), (snap) => {
      setServices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Service)));
    }, (err) => {
      console.error("ClientDetails Services Snapshot Error:", err);
    });

    const unsubLabels = firestore.onSnapshot(firestore.collection(db, 'labels'), (snap) => {
      setAllLabels(snap.docs.map(d => ({ id: d.id, ...d.data() } as Label)));
    }, (err) => {
      console.error("ClientDetails Labels Snapshot Error:", err);
    });

    return () => {
      unsubClient();
      unsubFollowups();
      unsubLogs();
      unsubServices();
      unsubLabels();
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
      ...activityLogs.map(l => ({ ...l, type: 'log' as const })),
      ...(client?.transferHistory || []).map(t => ({ ...t, type: 'transfer' as const, timestamp: t.timestamp }))
    ];
    return items.sort((a, b) => b.timestamp - a.timestamp);
  }, [followUps, activityLogs, client?.transferHistory]);

  const handleStartCall = async (appointmentId?: string) => {
    if (!user || !client) return;
    setIsCommunicating(true);
    setStartTime(Date.now());
    setActiveAppointmentId(appointmentId || null);
    await logActivity(user.uid, user.name, appointmentId ? "بدء متابعة لموعد مجدول" : "بدء جلسة تواصل", client.id, client.name);
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
        delayStatus,
        appointmentId: activeAppointmentId
      });

      const updateData: any = {
        status: isBooked ? ClientStatus.BOOKED : status,
        labels,
        lastFollowUpDate: Date.now(),
        nextFollowUpDate: nextTs || 0 // Clear if not rescheduled
      };

      if (isBooked) {
        updateData.isBooked = true;
        updateData.bookedCourseId = bookedCourseId;
        updateData.bookedCourseName = bookedCourseName;
        updateData.totalPrice = totalPrice;
        updateData.paidAmount = paidAmount;
        updateData.remainingAmount = remainingAmount;
        updateData.bookingDate = Date.now();
      }

      if (nextTs) {
        updateData.nextFollowUpDate = nextTs;
        updateData.nextFollowUpMethod = nextFollowUpMethod;
      }

      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), updateData);
      
      await logActivity(user.uid, user.name, `إنهاء متابعة: ${salesBrief}`, client.id, client.name);
      
      setShowForm(false);
      setNote(''); setResult(''); setSalesBrief('');
      setIsCommunicating(false);
      setStartTime(null);
      setElapsedTime(0);
    } catch (err) { console.error(err); }
  };

  const handleScheduleFollowUp = async () => {
    if (!client || !user || !nextDate) return;
    const nextTs = calculateTimestamp(nextDate, nextTime, nextPeriod);
    try {
      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), {
        nextFollowUpDate: nextTs,
        nextFollowUpMethod: nextFollowUpMethod
      });
      await logActivity(user.uid, user.name, `جدولة متابعة جديدة: ${new Date(nextTs).toLocaleString()}`, client.id, client.name);
      setIsScheduleModalOpen(false);
      setNextDate('');
    } catch (err) { console.error(err); }
  };

  const handleEditPhoneChange = (value: string) => {
    let cleaned = value.replace(/[^\d+]/g, ''); 
    
    let detected = false;
    if (cleaned.startsWith('+')) {
      for (const country of ARAB_COUNTRIES) {
        if (country.code && cleaned.startsWith(country.code)) {
          const rest = cleaned.substring(country.code.length).replace(/^0+/, '');
          setEditClientData(prev => ({
            ...prev,
            phone: rest,
            country: country.name,
            countryCode: country.code
          }));
          setShowCountrySelector(false);
          detected = true;
          break;
        }
      }
    } else if (cleaned.startsWith('00')) {
      const digits = cleaned.substring(2);
      for (const c of ARAB_COUNTRIES) {
        const codeDigits = c.code.replace(/\D/g, '');
        if (codeDigits && digits.startsWith(codeDigits)) {
          const rest = digits.substring(codeDigits.length).replace(/^0+/, '');
          setEditClientData(prev => ({
            ...prev,
            phone: rest,
            country: c.name,
            countryCode: c.code
          }));
          setShowCountrySelector(false);
          detected = true;
          break;
        }
      }
    }

    if (!detected) {
      setEditClientData(prev => ({ ...prev, phone: cleaned }));
      if (cleaned.length > 0) {
        setShowCountrySelector(true);
      }
    }
  };

  const handleUpdateClient = async () => {
    if (!client || !user) return;
    try {
      const finalData = { ...editClientData };
      
      // التنظيف التلقائي للرقم
      const cleanedPartial = cleanPhoneNumber(finalData.phone, client.countryCode || '+20');
      finalData.phone = (client.countryCode || '+20') + cleanedPartial;

      if (finalData.serviceId === 'other' && finalData.customServiceName) {
        finalData.serviceName = finalData.customServiceName;
      } else if (finalData.serviceId) {
        const service = services.find(s => s.id === finalData.serviceId);
        if (service) finalData.serviceName = service.name;
      }

      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), finalData);
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
              <button onClick={() => setIsEditModalOpen(true)} className="p-2 bg-slate-50 dark:bg-slate-800 rounded-xl text-slate-400 hover:text-primary-500 transition-colors"><Edit2 size={16}/></button>
            </div>
            <p className="text-primary-500 font-bold flex items-center gap-2 mt-1"><PhoneIncoming size={14}/> {client.phone}</p>
            <ContactButtons phone={client.phone} className="mt-2" iconSize={14} />
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="bg-primary-100 dark:bg-primary-500/10 text-primary-500 px-3 py-1 rounded-full text-[9px] font-black flex items-center gap-1">
                {client.source === ClientSource.WHATSAPP && <MessageCircle size={10}/>}
                {client.source === ClientSource.MESSENGER && <MessageSquare size={10}/>}
                {(client.source === ClientSource.FACEBOOK || client.source === ClientSource.TIKTOK) && <Globe size={10}/>}
                {SourceLabels[client.source || ClientSource.OTHER].ar}
              </span>
              {client.profileLink && (
                <a href={client.profileLink} target="_blank" className="bg-blue-100 dark:bg-blue-500/10 text-blue-500 px-3 py-1 rounded-full text-[9px] font-black flex items-center gap-1 hover:underline">
                  <ExternalLink size={10}/> رابط الحساب
                </a>
              )}
              <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-3 py-1 rounded-full text-[9px] font-black">{client.gender === Gender.MALE ? 'ذكر' : 'أنثى'}</span>
              <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-3 py-1 rounded-full text-[9px] font-black">{client.laptop === LaptopStatus.WITH ? 'لابتوب' : 'بدون لابتوب'}</span>
              <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-3 py-1 rounded-full text-[9px] font-black">{client.mode === AttendanceMode.ONLINE ? 'أونلاين' : 'أوفلاين'}</span>
              {client.labels?.map(labelId => {
                const label = allLabels.find(l => l.id === labelId);
                if (!label) return null;
                return (
                  <span 
                    key={labelId} 
                    className="px-3 py-1 rounded-full text-[9px] font-black text-white"
                    style={{ backgroundColor: label.color }}
                  >
                    {label.text}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex gap-3">
           {!isCommunicating && !showForm && (
            <>
              <button onClick={() => handleStartCall()} className="bg-primary-500 text-white px-10 py-4 rounded-2xl font-black shadow-xl flex items-center gap-3 text-xs uppercase hover:bg-primary-600 transition-all">
                <Play size={18} /> بدء المتابعة
              </button>
              <button onClick={() => setIsScheduleModalOpen(true)} className="bg-amber-500 text-white px-6 py-4 rounded-2xl font-black shadow-xl flex items-center gap-3 text-xs uppercase hover:bg-amber-600 transition-all">
                <CalendarPlus size={18} /> جدولة موعد
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
           <div><p className="text-[10px] font-black text-slate-400 uppercase">وقت التسجيل في النظام</p><p className="text-xs font-black text-slate-900 dark:text-white">{new Date(client.createdAt).toLocaleString('ar-EG')}</p></div>
        </div>
        <div className={`p-8 rounded-[2.5rem] shadow-xl text-center flex flex-col items-center justify-center relative overflow-hidden ${client.nextFollowUpDate && client.nextFollowUpDate < Date.now() ? 'bg-rose-500 text-white' : 'bg-primary-500 text-white'}`}>
           <p className="text-[10px] font-black uppercase opacity-80 mb-2">الموعد المجدول القادم</p>
           <p className="text-xl font-black">{client.nextFollowUpDate ? new Date(client.nextFollowUpDate).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'غير محدد'}</p>
           {client.nextFollowUpDate && client.nextFollowUpMethod && (
             <p className="text-[10px] font-black mt-1 bg-white/20 px-3 py-1 rounded-full">{CommMethodLabels[client.nextFollowUpMethod].ar}</p>
           )}
           {client.nextFollowUpDate && !isCommunicating && !showForm && (
             <button 
               onClick={() => handleStartCall('scheduled')}
               className="mt-4 bg-white text-primary-500 px-4 py-2 rounded-xl text-[10px] font-black shadow-lg hover:scale-105 transition-all"
             >
               بدء المتابعة لهذا الموعد
             </button>
           )}
        </div>
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-sm border border-slate-100 dark:border-slate-800 flex items-center gap-5">
           <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500 rounded-2xl flex items-center justify-center"><UserCheck size={28}/></div>
           <div><p className="text-[10px] font-black text-slate-400 uppercase">الحالة الحالية</p><p className="text-xs font-black text-slate-900 dark:text-white">{StatusLabels[client.status].ar}</p></div>
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
                  ) : item.type === 'transfer' ? (
                    <div className="space-y-2 p-4 bg-amber-50 dark:bg-amber-500/5 rounded-2xl border border-amber-100 dark:border-amber-500/10">
                      <p className="text-xs font-black text-amber-700 dark:text-amber-400 flex items-center gap-2">
                        <ArrowRightLeft size={14}/> إعادة تعيين المسؤول عن العميل
                      </p>
                      <div className="flex items-center gap-4 text-xs font-bold text-slate-600 dark:text-slate-300">
                        <div className="text-center">
                          <p className="text-[9px] text-slate-400 uppercase">من</p>
                          <p className="px-3 py-1 bg-white dark:bg-slate-800 rounded-lg">{item.oldAgentName}</p>
                        </div>
                        <ArrowRightLeft size={12} className="text-slate-300"/>
                        <div className="text-center">
                          <p className="text-[9px] text-slate-400 uppercase">إلى</p>
                          <p className="px-3 py-1 bg-primary-500 text-white rounded-lg">{item.newAgentName}</p>
                        </div>
                      </div>
                      {item.reason && <p className="text-[10px] text-slate-500 mt-2 italic font-bold">السبب: {item.reason}</p>}
                      <p className="text-[9px] text-slate-400 mt-2 font-black border-t border-amber-100 dark:border-amber-500/10 pt-2 flex items-center gap-2">
                         بواسطة: {item.performedByName} <span className="bg-amber-100 dark:bg-amber-500/20 px-2 py-0.5 rounded text-[8px] uppercase">إجراء إداري</span>
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{item.action}</p>
                  )}
                  <div className="mt-4 pt-3 border-t border-slate-50 dark:border-slate-800 text-[9px] font-black text-slate-400">
                    بواسطة: {item.type === 'followup' ? item.agentName : item.type === 'log' ? item.userName : item.performedByName}
                  </div>
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
                  <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm text-slate-900 dark:text-white" value={method} onChange={e => setMethod(e.target.value as CommMethod)}>
                    {(Object.entries(CommMethodLabels) as [string, {ar: string}][]).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">موجز السيلز (خلاصة سريعة لما تم الوصول إليه)</label>
                  <input required placeholder="مثال: مهتم بالعرض ويريد تفاصيل الحجز" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm text-slate-900 dark:text-white outline-none border border-transparent focus:border-primary-500" value={salesBrief} onChange={e => setSalesBrief(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">النتيجة التفصيلية</label>
                  <input required placeholder="سجل الرد النهائي للعميل..." className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:border-primary-500 border border-transparent" value={result} onChange={e => setResult(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">ملاحظات داخلية</label>
                  <textarea placeholder="أي ملاحظات فنية إضافية..." className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm text-slate-900 dark:text-white outline-none h-24 focus:border-primary-500 border border-transparent" value={note} onChange={e => setNote(e.target.value)} />
                </div>
                
                <div className="p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl space-y-3">
                   <div className="flex items-center justify-between">
                      <label className="text-[11px] font-black text-slate-700 dark:text-slate-300">تحديد موعد تواصل جديد؟</label>
                      <input type="checkbox" checked={scheduleNext} onChange={e => setScheduleNext(e.target.checked)} className="w-5 h-5 accent-primary-500" />
                   </div>
                   {scheduleNext && (
                      <div className="space-y-3 animate-fade-in pt-2">
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">تاريخ المتابعة</label>
                          <input type="date" className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs text-slate-900 dark:text-white" value={nextDate} onChange={e => setNextDate(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase">نوع التواصل القادم</label>
                          <select className="w-full p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs text-slate-900 dark:text-white" value={nextFollowUpMethod} onChange={e => setNextFollowUpMethod(e.target.value as CommMethod)}>
                            {(Object.entries(CommMethodLabels) as [string, {ar: string}][]).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <input type="time" className="flex-1 p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs text-slate-900 dark:text-white" value={nextTime} onChange={e => setNextTime(e.target.value)} />
                          <select className="p-3 bg-white dark:bg-slate-900 rounded-xl font-bold text-xs text-slate-900 dark:text-white" value={nextPeriod} onChange={e => setNextPeriod(e.target.value as any)}>
                            <option value="AM">AM</option><option value="PM">PM</option>
                          </select>
                        </div>
                      </div>
                   )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">تحديث حالة العميل</label>
                  <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm text-slate-900 dark:text-white" value={status} onChange={e => setStatus(e.target.value as ClientStatus)}>
                    {Object.entries(StatusLabels).map(([k,v]) => <option key={k} value={k}>{v.ar}</option>)}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">تحديث التصنيفات (Labels)</label>
                  <div className="flex flex-wrap gap-2 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl min-h-[60px]">
                    {allLabels.map(label => {
                      const isSelected = labels.includes(label.id);
                      return (
                        <button
                          key={label.id}
                          type="button"
                          onClick={() => {
                            setLabels(prev => isSelected ? prev.filter(id => id !== label.id) : [...prev, label.id]);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border-2 flex items-center gap-2`}
                          style={{
                            backgroundColor: isSelected ? label.color : 'transparent',
                            borderColor: label.color,
                            color: isSelected ? '#fff' : label.color,
                          }}
                        >
                          {label.text}
                          {isSelected && <X size={12} />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Booking Section */}
                <div className="p-5 bg-amber-50 dark:bg-amber-500/5 rounded-2xl border border-amber-200 dark:border-amber-500/20 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-black text-amber-700 dark:text-amber-400">هل قام العميل بالحجز؟</label>
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

                <button type="submit" className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:bg-primary-600 transition-all active:scale-[0.98]">حفظ وإتمام المتابعة</button>
              </form>
            </div>
          ) : (
            <div className="p-10 text-center bg-slate-50 dark:bg-slate-900/50 rounded-[3rem] border-2 border-dashed border-slate-200 dark:border-slate-800">
               <p className="text-xs font-black text-slate-400">سجل تواصلك مع العميل الآن لتوثيق التحركات</p>
            </div>
          )}
        </aside>
      </div>

      <FloatingPanel 
        isOpen={isScheduleModalOpen} 
        onClose={() => setIsScheduleModalOpen(false)} 
        title="جدولة موعد"
        icon={<CalendarPlus className="text-amber-500"/>}
      >
             <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">تاريخ المتابعة</label>
                  <input type="date" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-slate-900 dark:text-white border border-transparent focus:border-primary-500 outline-none" value={nextDate} onChange={e => setNextDate(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input type="time" className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-slate-900 dark:text-white border border-transparent focus:border-primary-500 outline-none" value={nextTime} onChange={e => setNextTime(e.target.value)} />
                  <select className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-slate-900 dark:text-white border border-transparent focus:border-primary-500 outline-none" value={nextPeriod} onChange={e => setNextPeriod(e.target.value as any)}>
                    <option value="AM">AM</option><option value="PM">PM</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">نوع التواصل</label>
                  <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-slate-900 dark:text-white border border-transparent focus:border-primary-500 outline-none" value={nextFollowUpMethod} onChange={e => setNextFollowUpMethod(e.target.value as CommMethod)}>
                    {(Object.entries(CommMethodLabels) as [string, {ar: string}][]).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
                  </select>
                </div>
                <button onClick={handleScheduleFollowUp} className="w-full py-5 bg-amber-500 text-white rounded-3xl font-black shadow-xl hover:bg-amber-600 transition-all active:scale-[0.98]">تأكيد الجدولة</button>
             </div>
      </FloatingPanel>

      <FloatingPanel 
        isOpen={isEditModalOpen} 
        onClose={() => setIsEditModalOpen(false)} 
        title="تعديل الملف"
        icon={<Edit2 size={24} />}
      >
             <div className="space-y-4 px-1">
               <div className="space-y-1.5 text-right">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">المنصة (Source)</label>
                  <select required className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none text-slate-900 dark:text-white" value={editClientData.source} onChange={e => setEditClientData({...editClientData, source: e.target.value as ClientSource})}>
                    {Object.entries(SourceLabels).map(([k,v]) => <option key={k} value={k}>{v.ar}</option>)}
                  </select>
               </div>
               
               {editClientData.source !== ClientSource.WHATSAPP && (
                 <div className="space-y-1.5 animate-fade-in text-right">
                   <label className="text-[10px] font-black text-slate-400 uppercase mr-2">رابط الحساب (Link)</label>
                   <input className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold text-slate-900 dark:text-white" placeholder="https://facebook.com/..." value={editClientData.profileLink} onChange={e => setEditClientData({...editClientData, profileLink: e.target.value})} />
                 </div>
               )}

               <div className="space-y-1.5 text-right">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">الاسم</label>
                  <input className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-slate-900 dark:text-white text-right" value={editClientData.name} onChange={e => setEditClientData({...editClientData, name: e.target.value})} placeholder="الاسم" />
               </div>
               
               <div className="space-y-4">
                 <div className="space-y-1.5 text-right">
                    <label className="text-[10px] font-black text-slate-400 uppercase mr-2">رقم الهاتف</label>
                    <div className="relative group">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 transition-colors group-focus-within:text-primary-500" dir="ltr">
                        {editClientData.countryCode || <Globe size={14} className="opacity-50"/>}
                      </span>
                      <input 
                        className="w-full p-4 pl-16 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none text-slate-900 dark:text-white text-right border-2 border-transparent focus:border-primary-500/20 transition-all" 
                        dir="ltr" 
                        type="tel"
                        placeholder="مثال: 01012345678 أو +2010..." 
                        value={editClientData.phone} 
                        onChange={e => handleEditPhoneChange(e.target.value)} 
                        onPaste={(e) => {
                          setTimeout(() => {
                            const input = e.target as HTMLInputElement;
                            handleEditPhoneChange(input.value);
                          }, 0);
                        }}
                      />
                    </div>
                    {editClientData.country && !showCountrySelector && (
                      <p className="text-[10px] font-bold text-primary-500 mt-1 mr-2 animate-fade-in flex items-center gap-1">
                        <Globe size={10}/> دولة العميل: {editClientData.country} ({editClientData.countryCode})
                        <button type="button" onClick={() => setShowCountrySelector(true)} className="mr-2 text-slate-400 underline hover:text-slate-600 transition-colors">تغيير</button>
                      </p>
                    )}
                 </div>

                 {showCountrySelector && (
                   <div className="space-y-1.5 animate-fade-in text-right">
                      <label className="text-[10px] font-black text-slate-400 uppercase mr-2">اختر الدولة (لإضافة كود الدولة تلقائياً)</label>
                      <div className="flex gap-2">
                        <select className="flex-1 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none text-slate-900 dark:text-white border-2 border-primary-500/10" value={editClientData.country} onChange={e => {
                          const country = ARAB_COUNTRIES.find(c => c.name === e.target.value);
                          setEditClientData({...editClientData, country: e.target.value, countryCode: country?.code || ''});
                          setShowCountrySelector(false);
                        }}>
                          <option value="">اختر الدولة...</option>
                          {ARAB_COUNTRIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                        </select>
                        <button type="button" onClick={() => setShowCountrySelector(false)} className="p-4 text-slate-400 hover:text-rose-500 transition-colors">
                          <X size={20}/>
                        </button>
                      </div>
                   </div>
                 )}
               </div>
               
               <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">الخدمة المطلوبة</label>
                  <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none text-slate-900 dark:text-white" value={editClientData.serviceId || ''} onChange={e => setEditClientData({...editClientData, serviceId: e.target.value})}>
                    <option value="">اختر الخدمة...</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    <option value="other">خدمة أخرى...</option>
                  </select>
               </div>

               {editClientData.serviceId === 'other' && (
                  <div className="space-y-1.5 animate-fade-in">
                     <label className="text-[10px] font-black text-slate-400 uppercase mr-2">اسم الخدمة الأخرى</label>
                     <input className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold text-slate-900 dark:text-white border-2 border-primary-500/30" placeholder="أدخل اسم الخدمة..." value={editClientData.customServiceName || ''} onChange={e => setEditClientData({...editClientData, customServiceName: e.target.value})} />
                  </div>
               )}

               <div className="grid grid-cols-3 gap-3">
                  <select className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-slate-900 dark:text-white text-xs" value={editClientData.gender} onChange={e => setEditClientData({...editClientData, gender: e.target.value as Gender})}>
                    <option value={Gender.MALE}>ذكر</option><option value={Gender.FEMALE}>أنثى</option>
                  </select>
                  <select className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-slate-900 dark:text-white text-xs" value={editClientData.laptop} onChange={e => setEditClientData({...editClientData, laptop: e.target.value as LaptopStatus})}>
                    <option value={LaptopStatus.WITH}>لابتوب</option><option value={LaptopStatus.WITHOUT}>بدون</option>
                  </select>
                  <select className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-slate-900 dark:text-white text-xs" value={editClientData.mode} onChange={e => setEditClientData({...editClientData, mode: e.target.value as AttendanceMode})}>
                    <option value={AttendanceMode.OFFLINE}>أوفلاين</option><option value={AttendanceMode.ONLINE}>أونلاين</option>
                  </select>
               </div>
               <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">التصنيفات (Labels)</label>
                  <div className="flex flex-wrap gap-2 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl min-h-[60px]">
                    {allLabels.map(label => {
                      const isSelected = editClientData.labels.includes(label.id);
                      return (
                        <button
                          key={label.id}
                          type="button"
                          onClick={() => {
                            const labels = isSelected
                              ? editClientData.labels.filter(id => id !== label.id)
                              : [...editClientData.labels, label.id];
                            setEditClientData({...editClientData, labels});
                          }}
                          className={`px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border-2 flex items-center gap-2`}
                          style={{
                            backgroundColor: isSelected ? label.color : 'transparent',
                            borderColor: label.color,
                            color: isSelected ? '#fff' : label.color,
                          }}
                        >
                          {label.text}
                          {isSelected && <X size={12} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
               <button onClick={handleUpdateClient} className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:bg-primary-600 transition-all active:scale-[0.98]">حفظ التغييرات</button>
             </div>
      </FloatingPanel>

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
