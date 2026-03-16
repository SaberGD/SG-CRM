
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as firestore from 'firebase/firestore';
import { db, logActivity, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../App';
import { 
  Client, ClientStatus, StatusLabels, UserRole, Service, Label, 
  ClientTransfer, CommMethod, CommMethodLabels, Gender, LaptopStatus, AttendanceMode 
} from '../types';
import { 
  Plus, Search, MessageCircle, History, ArrowRightLeft, Trash2, 
  Phone, Calendar, MessageSquare, User, Laptop, Globe, Clock, X
} from 'lucide-react';

const ARAB_COUNTRIES = [
  { name: 'مصر', code: '+20' },
  { name: 'السعودية', code: '+966' },
  { name: 'الإمارات', code: '+971' },
  { name: 'الكويت', code: '+965' },
  { name: 'قطر', code: '+974' },
  { name: 'الأردن', code: '+962' },
  { name: 'عمان', code: '+968' },
  { name: 'البحرين', code: '+973' },
  { name: 'أخرى', code: '' }
];

const ClientsList: React.FC = () => {
  const { user, effectiveRole, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [salesAgents, setSalesAgents] = useState<{id: string, name: string}[]>([]);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterService, setFilterService] = useState<string>('all');
  const [filterLabel, setFilterLabel] = useState<string>('all');
  const [filterLaptop, setFilterLaptop] = useState<string>('all');
  const [filterMode, setFilterMode] = useState<string>('all');
  const [filterGender, setFilterGender] = useState<string>('all');
  const [filterBookedCourse, setFilterBookedCourse] = useState<string>('all');
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [transferAgentId, setTransferAgentId] = useState('');
  const [transferReason, setTransferReason] = useState('');

  const [newClient, setNewClient] = useState({ 
    name: '', phone: '', status: ClientStatus.INTERESTED, 
    gender: Gender.MALE, laptop: LaptopStatus.WITHOUT, mode: AttendanceMode.OFFLINE,
    serviceId: '', customServiceName: '', country: 'مصر', countryCode: '+20', 
    labels: [] as string[],
    notes: '',
    preferredMethod: CommMethod.PHONE,
    nextFollowUpMethod: CommMethod.PHONE,
    scheduleNext: false,
    nextDate: '',
    nextTime: '10:00',
    nextPeriod: 'AM' as 'AM' | 'PM',
    isBooked: false,
    bookedCourseId: '',
    bookedCourseName: '',
    totalPrice: 0,
    paidAmount: 0,
    remainingAmount: 0
  });

  const isHighRole = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER || effectiveRole === UserRole.TEAM_LEADER;
  const canDelete = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER;

  useEffect(() => {
    if (authLoading || !user) return;
    
    const clientsRef = firestore.collection(db, 'clients');
    let q;
    
    if (isHighRole) {
      q = firestore.query(clientsRef, firestore.orderBy('createdAt', 'desc'), firestore.limit(500));
    } else {
      q = firestore.query(clientsRef, firestore.where('salesAgentId', '==', user.uid), firestore.orderBy('createdAt', 'desc'));
    }
    
    const unsubClients = firestore.onSnapshot(q, (snapshot) => {
      setClients(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
    }, (err) => {
      console.error("ClientsList Clients Snapshot Error:", err);
    });

    const unsubServices = firestore.onSnapshot(firestore.query(firestore.collection(db, 'services'), firestore.where('isActive', '==', true)), snap => {
      setServices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Service)));
    }, (err) => {
      console.error("ClientsList Services Snapshot Error:", err);
    });

    const unsubLabels = firestore.onSnapshot(firestore.collection(db, 'labels'), snap => {
      setAllLabels(snap.docs.map(d => ({ id: d.id, ...d.data() } as Label)));
    }, (err) => {
      console.error("ClientsList Labels Snapshot Error:", err);
    });

    if (isHighRole) {
      firestore.getDocs(firestore.query(firestore.collection(db, 'users'), firestore.where('role', 'in', [UserRole.SALES_AGENT, UserRole.TEAM_LEADER]))).then(snap => {
        setSalesAgents(snap.docs.map(d => ({ id: d.id, name: d.data().name })));
      });
    }

    return () => {
      unsubClients();
      unsubServices();
      unsubLabels();
    };
  }, [authLoading, user, effectiveRole]);

  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      const term = searchTerm.toLowerCase();
      const matchesSearch = c.name.toLowerCase().includes(term) || c.phone.includes(term);
      const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
      const matchesService = filterService === 'all' || c.serviceId === filterService;
      const matchesLabel = filterLabel === 'all' || (c.labels && c.labels.includes(filterLabel));
      const matchesLaptop = filterLaptop === 'all' || c.laptop === filterLaptop;
      const matchesMode = filterMode === 'all' || c.mode === filterMode;
      const matchesGender = filterGender === 'all' || c.gender === filterGender;
      const matchesBookedCourse = filterBookedCourse === 'all' || c.bookedCourseId === filterBookedCourse;
      
      return matchesSearch && matchesStatus && matchesService && matchesLabel && matchesLaptop && matchesMode && matchesGender && matchesBookedCourse;
    });
  }, [clients, searchTerm, filterStatus, filterService, filterLabel, filterLaptop, filterMode, filterGender, filterBookedCourse]);

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const phoneFull = newClient.countryCode + newClient.phone.replace(/^0+/, '');
    
    // منع التكرار
    const phoneCheck = await firestore.getDocs(firestore.query(firestore.collection(db, 'clients'), firestore.where('phone', '==', phoneFull)));
    if (!phoneCheck.empty) return alert("هذا الرقم مسجل مسبقاً باسم: " + phoneCheck.docs[0].data().name);

    const isOtherService = newClient.serviceId === 'other';
    const serviceName = isOtherService ? newClient.customServiceName : (services.find(s => s.id === newClient.serviceId)?.name || 'أخرى');

    let nextTs = 0;
    if (newClient.scheduleNext && newClient.nextDate) {
      const [h, m] = newClient.nextTime.split(':').map(Number);
      const finalH = newClient.nextPeriod === 'PM' && h < 12 ? h + 12 : (newClient.nextPeriod === 'AM' && h === 12 ? 0 : h);
      const dateObj = new Date(newClient.nextDate);
      dateObj.setHours(finalH, m, 0, 0);
      nextTs = dateObj.getTime();
    }

    try {
      const { nextDate, nextTime, nextPeriod, scheduleNext, isBooked, bookedCourseId, bookedCourseName, totalPrice, paidAmount, remainingAmount, customServiceName, ...clientToSave } = newClient;
      const dataToSave: any = { 
        ...clientToSave, 
        phone: phoneFull,
        serviceName,
        nextFollowUpDate: nextTs,
        salesAgentId: user.uid, 
        salesAgentName: user.name, 
        createdAt: Date.now() 
      };
      
      if (nextTs) {
        dataToSave.nextFollowUpMethod = newClient.nextFollowUpMethod;
      }

      if (isBooked) {
        dataToSave.isBooked = true;
        dataToSave.isBookedOnCreation = true;
        dataToSave.bookedCourseId = bookedCourseId;
        dataToSave.bookedCourseName = bookedCourseName;
        dataToSave.totalPrice = totalPrice;
        dataToSave.paidAmount = paidAmount;
        dataToSave.remainingAmount = remainingAmount;
        dataToSave.bookingDate = Date.now();
        dataToSave.status = ClientStatus.BOOKED;
      }

      console.log("Attempting to add client with data:", dataToSave);
      const docRef = await firestore.addDoc(firestore.collection(db, 'clients'), dataToSave);
      console.log("Client added successfully, ID:", docRef.id);
      await logActivity(user.uid, user.name, `إضافة عميل جديد: ${newClient.name}`, docRef.id, newClient.name);
      setIsAddModalOpen(false);
      setNewClient({ 
        name: '', phone: '', status: ClientStatus.INTERESTED, 
        gender: Gender.MALE, laptop: LaptopStatus.WITHOUT, mode: AttendanceMode.OFFLINE,
        serviceId: '', customServiceName: '', country: 'مصر', countryCode: '+20', 
        labels: [], notes: '', preferredMethod: CommMethod.PHONE,
        nextFollowUpMethod: CommMethod.PHONE,
        scheduleNext: false,
        nextDate: '', nextTime: '10:00', nextPeriod: 'AM' 
      });
    } catch (err) { 
      handleFirestoreError(err, OperationType.CREATE, 'clients');
      alert("حدث خطأ في الصلاحيات أثناء إضافة العميل. يرجى التأكد من إعدادات Firebase.");
    }
  };

  const updateRemaining = (total: number, paid: number) => {
    setNewClient(prev => ({ ...prev, totalPrice: total, paidAmount: paid, remainingAmount: total - paid }));
  };

  const handleTransfer = async () => {
    if (!selectedClient || !transferAgentId) return;
    const newAgent = salesAgents.find(a => a.id === transferAgentId);
    if (!newAgent) return;

    try {
      await firestore.addDoc(firestore.collection(db, 'transfers'), {
        clientId: selectedClient.id, clientName: selectedClient.name,
        oldAgentId: selectedClient.salesAgentId, oldAgentName: selectedClient.salesAgentName,
        newAgentId: newAgent.id, newAgentName: newAgent.name,
        reason: transferReason, timestamp: Date.now(),
        performedById: user!.uid, performedByName: user!.name
      });
      await firestore.updateDoc(firestore.doc(db, 'clients', selectedClient.id), { 
        salesAgentId: newAgent.id, 
        salesAgentName: newAgent.name 
      });
      await logActivity(user!.uid, user!.name, `تحويل العميل إلى ${newAgent.name}`, selectedClient.id, selectedClient.name);
      setIsTransferModalOpen(false);
      setSelectedClient(null);
    } catch (err) { 
      handleFirestoreError(err, OperationType.WRITE, 'clients/transfers');
      alert("حدث خطأ في الصلاحيات أثناء تحويل العميل. يرجى التأكد من أنك تملك صلاحية Team Leader على الأقل.");
    }
  };

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">قائمة <span className="text-primary-500">العملاء</span></h1>
          <p className="text-slate-500 font-bold mt-1">إدارة بيانات المتقدمين والمتابعات</p>
        </div>
        <button onClick={() => setIsAddModalOpen(true)} className="bg-primary-500 text-white px-8 py-4 rounded-3xl font-black text-xs uppercase shadow-xl hover:bg-primary-600 transition-all flex items-center gap-2">
          <Plus size={18} /> إضافة عميل جديد
        </button>
      </header>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" placeholder="بحث بالاسم أو الهاتف..." 
                className="w-full pr-12 pl-4 py-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold text-sm dark:text-white"
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <select className="bg-slate-50 dark:bg-slate-800 px-6 py-4 rounded-2xl font-black text-xs text-slate-500 outline-none dark:text-slate-300" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">كل الحالات</option>
              {Object.entries(StatusLabels).map(([k,v]) => <option key={k} value={k}>{v.ar}</option>)}
            </select>
            <select className="bg-slate-50 dark:bg-slate-800 px-6 py-4 rounded-2xl font-black text-xs text-slate-500 outline-none dark:text-slate-300" value={filterService} onChange={e => setFilterService(e.target.value)}>
              <option value="all">كل الخدمات المطلوبة</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            <select className="bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-xl font-bold text-[10px] text-slate-500 outline-none dark:text-slate-300" value={filterLabel} onChange={e => setFilterLabel(e.target.value)}>
              <option value="all">كل التصنيفات (Labels)</option>
              {allLabels.map(l => <option key={l.id} value={l.id}>{l.text}</option>)}
            </select>
            
            <select className="bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-xl font-bold text-[10px] text-slate-500 outline-none dark:text-slate-300" value={filterBookedCourse} onChange={e => setFilterBookedCourse(e.target.value)}>
              <option value="all">الكورس المحجوز</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>

            <select className="bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-xl font-bold text-[10px] text-slate-500 outline-none dark:text-slate-300" value={filterLaptop} onChange={e => setFilterLaptop(e.target.value)}>
              <option value="all">حالة اللابتوب</option>
              <option value={LaptopStatus.WITH}>مع لابتوب</option>
              <option value={LaptopStatus.WITHOUT}>بدون لابتوب</option>
            </select>

            <select className="bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-xl font-bold text-[10px] text-slate-500 outline-none dark:text-slate-300" value={filterMode} onChange={e => setFilterMode(e.target.value)}>
              <option value="all">نظام الحضور</option>
              <option value={AttendanceMode.ONLINE}>أونلاين</option>
              <option value={AttendanceMode.OFFLINE}>أوفلاين</option>
            </select>

            <select className="bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-xl font-bold text-[10px] text-slate-500 outline-none dark:text-slate-300" value={filterGender} onChange={e => setFilterGender(e.target.value)}>
              <option value="all">الجنس</option>
              <option value={Gender.MALE}>ذكر</option>
              <option value={Gender.FEMALE}>أنثى</option>
            </select>
          </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-[3rem] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">العميل / وقت التسجيل</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">الحالة / الخدمة</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">المواصفات</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">المسؤول</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                  الإجراءات
                  <div className="flex justify-center gap-3 mt-1 text-[7px] opacity-70 font-bold">
                    <span>واتساب</span>
                    <span>السجل</span>
                    {isHighRole && <span>تحويل</span>}
                    {canDelete && <span>حذف</span>}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredClients.length === 0 ? (
                <tr><td colSpan={5} className="py-20 text-center text-slate-400 font-bold italic">لا يوجد عملاء حالياً</td></tr>
              ) : filteredClients.map((client) => (
                <tr key={client.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-all">
                  <td className="px-8 py-6">
                    <p onClick={() => navigate(`/clients/${client.id}`)} className="font-black text-sm text-slate-900 dark:text-white cursor-pointer hover:text-primary-500">{client.name}</p>
                    <p className="text-[9px] font-black text-slate-400 mt-1 flex items-center gap-1">
                      <Clock size={10}/> {new Date(client.createdAt).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${StatusLabels[client.status]?.color || ''}`}>
                      {StatusLabels[client.status]?.ar}
                    </span>
                    <p className="text-[10px] font-bold text-slate-500 mt-1">{client.serviceName}</p>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex flex-wrap gap-1">
                      <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded text-[8px] font-black">{client.gender === Gender.MALE ? 'ذكر' : 'أنثى'}</span>
                      <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded text-[8px] font-black">{client.laptop === LaptopStatus.WITH ? 'لابتوب' : 'بدون لابتوب'}</span>
                      <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded text-[8px] font-black">{client.mode === AttendanceMode.ONLINE ? 'أونلاين' : 'أوفلاين'}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-center text-[10px] text-slate-500 font-bold italic">{client.salesAgentName}</td>
                  <td className="px-8 py-6">
                    <div className="flex justify-center gap-2">
                      <a href={`https://wa.me/${client.phone.replace('+', '')}`} target="_blank" title="تواصل عبر واتساب" className="p-2.5 bg-emerald-50 text-emerald-500 rounded-xl hover:scale-110 transition-all dark:bg-emerald-500/10"><MessageCircle size={16} /></a>
                      <button onClick={() => navigate(`/clients/${client.id}`)} title="عرض السجل والمتابعة" className="p-2.5 bg-primary-50 text-primary-500 rounded-xl hover:scale-110 transition-all dark:bg-primary-500/10"><History size={16} /></button>
                      {isHighRole && (
                        <button onClick={() => { setSelectedClient(client); setIsTransferModalOpen(true); }} title="تحويل العميل لموظف آخر" className="p-2.5 bg-amber-50 text-amber-500 rounded-xl hover:scale-110 transition-all dark:bg-amber-500/10"><ArrowRightLeft size={16} /></button>
                      )}
                      {canDelete && (
                        <button onClick={async () => { 
                          const confirmation = prompt("لحذف العميل نهائياً، يرجى كتابة كلمة 'delete' للتأكيد:");
                          if(confirmation === 'delete') {
                            try {
                              await firestore.deleteDoc(firestore.doc(db, 'clients', client.id));
                              await logActivity(user!.uid, user!.name, `حذف العميل نهائياً: ${client.name}`, client.id, client.name);
                              alert("تم حذف العميل بنجاح");
                            } catch (error) {
                              console.error("Error deleting client:", error);
                              alert("حدث خطأ أثناء الحذف. يرجى التحقق من الصلاحيات.");
                            }
                          } else if (confirmation !== null) {
                            alert("كلمة التأكيد غير صحيحة، لم يتم الحذف.");
                          }
                        }} title="حذف العميل" className="p-2.5 bg-rose-50 text-rose-500 rounded-xl hover:scale-110 transition-all dark:bg-rose-500/10"><Trash2 size={16} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/40 backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-2xl p-10 my-4 sm:my-10 space-y-6 animate-fade-in shadow-2xl border border-slate-100 dark:border-slate-800">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black flex items-center gap-3"><Plus className="text-primary-500" /> إضافة عميل جديد</h2>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-900"><X size={24}/></button>
            </div>
            <form onSubmit={handleAddClient} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">الاسم بالكامل</label>
                  <input required className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold dark:text-white" placeholder="أدخل الاسم..." value={newClient.name} onChange={e => setNewClient({...newClient, name: e.target.value})} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">حالة العميل</label>
                  <select required className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={newClient.status} onChange={e => setNewClient({...newClient, status: e.target.value as ClientStatus})}>
                    {(Object.entries(StatusLabels) as [ClientStatus, any][]).map(([k, v]) => (
                      <option key={k} value={k}>{v.ar}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                   <label className="text-[10px] font-black text-slate-400 uppercase mr-2">الخدمة المطلوبة</label>
                   <select required className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={newClient.serviceId} onChange={e => setNewClient({...newClient, serviceId: e.target.value})}>
                    <option value="">اختر الخدمة...</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    <option value="other">خدمة أخرى...</option>
                  </select>
                </div>
                {newClient.serviceId === 'other' && (
                  <div className="space-y-1.5 animate-fade-in">
                    <label className="text-[10px] font-black text-slate-400 uppercase mr-2">اسم الخدمة الأخرى</label>
                    <input required className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold dark:text-white border-2 border-primary-500/30" placeholder="أدخل اسم الخدمة..." value={newClient.customServiceName} onChange={e => setNewClient({...newClient, customServiceName: e.target.value})} />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">الجنس</label>
                  <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={newClient.gender} onChange={e => setNewClient({...newClient, gender: e.target.value as Gender})}>
                    <option value={Gender.MALE}>ذكر</option>
                    <option value={Gender.FEMALE}>أنثى</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">حالة اللابتوب</label>
                  <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={newClient.laptop} onChange={e => setNewClient({...newClient, laptop: e.target.value as LaptopStatus})}>
                    <option value={LaptopStatus.WITH}>مع لابتوب</option>
                    <option value={LaptopStatus.WITHOUT}>بدون لابتوب</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">نظام الحضور</label>
                  <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={newClient.mode} onChange={e => setNewClient({...newClient, mode: e.target.value as AttendanceMode})}>
                    <option value={AttendanceMode.OFFLINE}>أوفلاين (في المقر)</option>
                    <option value={AttendanceMode.ONLINE}>أونلاين (عن بعد)</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-1/3 space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">الدولة</label>
                  <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={newClient.country} onChange={e => {
                    const country = ARAB_COUNTRIES.find(c => c.name === e.target.value);
                    setNewClient({...newClient, country: e.target.value, countryCode: country?.code || ''});
                  }}>
                    {ARAB_COUNTRIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div className="flex-1 space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">رقم الهاتف (بدون كود الدولة)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400" dir="ltr">{newClient.countryCode}</span>
                    <input required className="w-full p-4 pl-16 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold text-right dark:text-white" dir="ltr" placeholder="01012345678" value={newClient.phone} onChange={e => setNewClient({...newClient, phone: e.target.value})} />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2">التصنيفات (Labels) - اختياري</label>
                <div className="flex flex-wrap gap-2 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl min-h-[60px]">
                  {allLabels.map(label => {
                    const isSelected = newClient.labels.includes(label.id);
                    return (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() => {
                          const labels = isSelected
                            ? newClient.labels.filter(id => id !== label.id)
                            : [...newClient.labels, label.id];
                          setNewClient({...newClient, labels});
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
                  {allLabels.length === 0 && <p className="text-[10px] font-bold text-slate-400">لا توجد تصنيفات متاحة. يمكنك إضافتها من صفحة الإعدادات.</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">نوع التواصل المفضل</label>
                  <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={newClient.preferredMethod} onChange={e => setNewClient({...newClient, preferredMethod: e.target.value as CommMethod})}>
                    {(Object.entries(CommMethodLabels) as [string, {ar: string}][]).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">ملاحظات إضافية</label>
                  <textarea className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold h-14 dark:text-white" value={newClient.notes} onChange={e => setNewClient({...newClient, notes: e.target.value})} />
                </div>
              </div>

              <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-[2rem] space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase text-slate-400">جدولة أول متابعة</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400">تفعيل الجدولة</span>
                    <input type="checkbox" checked={newClient.scheduleNext} onChange={e => setNewClient({...newClient, scheduleNext: e.target.checked})} className="w-5 h-5 accent-primary-500" />
                  </div>
                </div>
                
                {newClient.scheduleNext && (
                  <div className="space-y-4 animate-fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase mr-2">تاريخ المتابعة</label>
                        <input type="date" required className="w-full p-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none" value={newClient.nextDate} onChange={e => setNewClient({...newClient, nextDate: e.target.value})} />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase mr-2">نوع التواصل المجدول</label>
                        <select className="w-full p-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none" value={newClient.nextFollowUpMethod} onChange={e => setNewClient({...newClient, nextFollowUpMethod: e.target.value as CommMethod})}>
                          {(Object.entries(CommMethodLabels) as [string, {ar: string}][]).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
                        </select>
                      </div>
                    </div>
                    {newClient.nextDate && (
                      <div className="flex gap-2 animate-fade-in">
                        <input type="time" className="flex-1 p-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none" value={newClient.nextTime} onChange={e => setNewClient({...newClient, nextTime: e.target.value})} />
                        <select className="p-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none" value={newClient.nextPeriod} onChange={e => setNewClient({...newClient, nextPeriod: e.target.value as any})}>
                          <option value="AM">AM</option><option value="PM">PM</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="p-6 bg-amber-50 dark:bg-amber-500/5 rounded-[2rem] border border-amber-200 dark:border-amber-500/20 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase text-amber-600">تسجيل حجز فوري</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-amber-600">العميل حجز بالفعل</span>
                    <input type="checkbox" checked={newClient.isBooked} onChange={e => setNewClient({...newClient, isBooked: e.target.checked})} className="w-5 h-5 accent-amber-500" />
                  </div>
                </div>
                
                {newClient.isBooked && (
                  <div className="space-y-4 animate-fade-in">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase mr-2">الكورس المحجوز</label>
                      <select 
                        required 
                        className="w-full p-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none" 
                        value={newClient.bookedCourseId} 
                        onChange={e => {
                          const s = services.find(srv => srv.id === e.target.value);
                          setNewClient({...newClient, bookedCourseId: e.target.value, bookedCourseName: s?.name || ''});
                        }}
                      >
                        <option value="">اختر الكورس...</option>
                        {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase mr-2">السعر الإجمالي</label>
                        <input 
                          type="number" 
                          required 
                          className="w-full p-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none" 
                          value={newClient.totalPrice} 
                          onChange={e => updateRemaining(parseFloat(e.target.value) || 0, newClient.paidAmount)} 
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase mr-2">المبلغ المدفوع</label>
                        <input 
                          type="number" 
                          required 
                          className="w-full p-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none" 
                          value={newClient.paidAmount} 
                          onChange={e => updateRemaining(newClient.totalPrice, parseFloat(e.target.value) || 0)} 
                        />
                      </div>
                    </div>
                    <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-amber-100 dark:border-amber-500/10">
                      <p className="text-[9px] font-black text-slate-400 uppercase">المبلغ المتبقي</p>
                      <p className="text-sm font-black text-amber-600">{newClient.remainingAmount} ج.م</p>
                    </div>
                  </div>
                )}
              </div>

              <button type="submit" className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:bg-primary-600 transition-all uppercase text-xs">إضافة العميل وتوثيق وقت التسجيل</button>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {isTransferModalOpen && selectedClient && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/40 backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] w-full max-w-lg p-10 my-4 sm:my-20 space-y-6 shadow-2xl border border-slate-100 dark:border-slate-800">
            <h2 className="text-2xl font-black mb-4 flex items-center gap-2"><ArrowRightLeft className="text-amber-500"/> تحويل العميل</h2>
            <p className="text-sm font-bold text-slate-500">تحويل <span className="text-primary-500 font-black">{selectedClient.name}</span> لموظف آخر:</p>
            <div className="space-y-4">
              <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={transferAgentId} onChange={e => setTransferAgentId(e.target.value)}>
                <option value="">اختر الموظف...</option>
                {salesAgents.filter(a => a.id !== selectedClient.salesAgentId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <textarea placeholder="سبب التحويل..." className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none h-24 dark:text-white" value={transferReason} onChange={e => setTransferReason(e.target.value)} />
              <button onClick={handleTransfer} className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl">تأكيد التحويل</button>
              <button onClick={() => setIsTransferModalOpen(false)} className="w-full py-4 text-slate-400 font-bold uppercase text-[10px]">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientsList;
