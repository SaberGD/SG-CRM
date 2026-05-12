
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as firestore from 'firebase/firestore';
import { db, logActivity, handleFirestoreError, OperationType, cleanPhoneNumber } from '../firebase';
import { useAuth } from '../App';
import { 
  Client, ClientStatus, StatusLabels, UserRole, Service, Label, 
  ClientTransfer, BulkTransfer, CommMethod, CommMethodLabels, Gender, LaptopStatus, AttendanceMode,
  ClientSource, SourceLabels, ARAB_COUNTRIES
} from '../types';
import FloatingPanel from '../components/FloatingPanel';
import { 
  Plus, Search, MessageCircle, History, ArrowRightLeft, Trash2, 
  Phone, Calendar, MessageSquare, User, Laptop, Globe, Clock, X,
  ExternalLink, Layers, AlertTriangle
} from 'lucide-react';
import ContactButtons from '../components/ContactButtons';

// Global cache for clients to reduce reads
const clientsCache: {
  data: Client[];
  lastVisible: firestore.DocumentData | null;
  hasMore: boolean;
  filters: string;
} = {
  data: [],
  lastVisible: null,
  hasMore: true,
  filters: ''
};

const ClientsList: React.FC = () => {
  const { user, effectiveRole, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState<Client[]>(clientsCache.data);
  const [services, setServices] = useState<Service[]>([]);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [salesAgents, setSalesAgents] = useState<{id: string, name: string}[]>([]);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterService, setFilterService] = useState<string>('all');
  const [filterLabel, setFilterLabel] = useState<string>('all');
  const [filterLaptop, setFilterLaptop] = useState<string>('all');
  const [filterMode, setFilterMode] = useState<string>('all');
  const [filterGender, setFilterGender] = useState<string>('all');
  const [filterBookedCourse, setFilterBookedCourse] = useState<string>('all');
  const [filterSalesAgent, setFilterSalesAgent] = useState<string>('all');
  
  // Pagination
  const [lastVisible, setLastVisible] = useState<firestore.DocumentData | null>(clientsCache.lastVisible);
  const [hasMore, setHasMore] = useState(clientsCache.hasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalRead, setTotalRead] = useState(0);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isBulkTransferOpen, setIsBulkTransferOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [transferAgentId, setTransferAgentId] = useState('');
  const [transferReason, setTransferReason] = useState('');

  const [bulkTransferFrom, setBulkTransferFrom] = useState('');
  const [bulkTransferTo, setBulkTransferTo] = useState('');
  const [recentBulkTransfers, setRecentBulkTransfers] = useState<BulkTransfer[]>([]);
  const [isUndoing, setIsUndoing] = useState(false);

  const [showCountrySelector, setShowCountrySelector] = useState(false);
  const [newClient, setNewClient] = useState({ 
    name: '', phone: '', status: ClientStatus.INTERESTED, 
    source: ClientSource.WHATSAPP, profileLink: '',
    gender: Gender.MALE, laptop: LaptopStatus.WITHOUT, mode: AttendanceMode.OFFLINE,
    serviceId: '', customServiceName: '', country: '', countryCode: '', 
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

  const handlePhoneChange = (val: string) => {
    // إزالة المسافات وكافة الرموز غير الرقمية (إلا علامة + في البداية)
    let cleaned = val.replace(/[^\d+]/g, '');
    
    // إذا بدأ بـ + فربما تم لصق كود الدولة
    let detected = false;
    if (cleaned.startsWith('+')) {
      for (const c of ARAB_COUNTRIES) {
        if (c.code && cleaned.startsWith(c.code)) {
          // إذا وجد تطابق، نحدث الدولة والرمز والجزء المتبقي من الرقم
          const rest = cleaned.substring(c.code.length).replace(/^0+/, '');
          setNewClient(prev => ({
            ...prev,
            country: c.name,
            countryCode: c.code,
            phone: rest
          }));
          setShowCountrySelector(false);
          detected = true;
          break;
        }
      }
    } else if (cleaned.startsWith('00')) {
      // التعامل مع صيغة 00 بدلاً من +
      const digits = cleaned.substring(2);
      for (const c of ARAB_COUNTRIES) {
        const codeDigits = c.code.replace(/\D/g, '');
        if (codeDigits && digits.startsWith(codeDigits)) {
          const rest = digits.substring(codeDigits.length).replace(/^0+/, '');
          setNewClient(prev => ({
            ...prev,
            country: c.name,
            countryCode: c.code,
            phone: rest
          }));
          setShowCountrySelector(false);
          detected = true;
          break;
        }
      }
    }
    
    if (!detected) {
      setNewClient(prev => ({...prev, phone: cleaned}));
      // إظهار اختيار الدولة إذا تم إدخال رقم بدون كود
      if (cleaned.length > 0) {
        setShowCountrySelector(true);
      }
    }
  };

  const isHighRole = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER || effectiveRole === UserRole.TEAM_LEADER;
  const canDelete = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER;

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 600);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (authLoading || !user || !effectiveRole) return;
    
    // Create a key for the current combination of filters
    const currentFiltersKey = JSON.stringify({
      effectiveRole,
      filterStatus,
      filterService,
      filterLabel,
      filterLaptop,
      filterMode,
      filterGender,
      filterBookedCourse,
      filterSalesAgent,
      debouncedSearch
    });

    // If filters have changed, we MUST reset data unless it was already cached for these filters
    if (clientsCache.filters !== currentFiltersKey) {
      setClients([]);
      setLastVisible(null);
      setHasMore(true);
      fetchClients(false, debouncedSearch);
      clientsCache.filters = currentFiltersKey;
    }

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
      firestore.getDocs(firestore.query(firestore.collection(db, 'users'), firestore.where('role', 'in', [UserRole.SALES_AGENT, UserRole.TEAM_LEADER, UserRole.MANAGER]))).then(snap => {
        setSalesAgents(snap.docs.map(d => ({ id: d.id, name: d.data().name })));
      });

      const unsubBulk = firestore.onSnapshot(
        firestore.query(
          firestore.collection(db, 'bulk_transfers'), 
          firestore.orderBy('timestamp', 'desc'), 
          firestore.limit(5)
        ), 
        snap => {
          setRecentBulkTransfers(snap.docs.map(d => ({ id: d.id, ...d.data() } as BulkTransfer)));
        }, (err) => {
          handleFirestoreError(err, OperationType.LIST, 'bulk_transfers');
        }
      );
      return () => {
        unsubBulk();
        unsubServices();
        unsubLabels();
      };
    }
    
    return () => {
      unsubServices();
      unsubLabels();
    };
  }, [authLoading, user, effectiveRole, filterStatus, filterService, filterLabel, filterLaptop, filterMode, filterGender, filterBookedCourse, filterSalesAgent, debouncedSearch]);

  const fetchClients = async (isMore: boolean, searchOverride?: string) => {
    if (!user || (!isMore && isLoadingMore)) return;
    setIsLoadingMore(true);

    const activeSearch = searchOverride !== undefined ? searchOverride : debouncedSearch;

    try {
      const clientsRef = firestore.collection(db, 'clients');
      let constraints: firestore.QueryConstraint[] = [];

      // Determine search method
      const isSearchActive = activeSearch.trim().length > 0;
      
      if (isSearchActive) {
        const term = activeSearch.trim();
        // If it's a numeric search (likely phone), try multiple formats match
        const isNumeric = /^[0-9+]+$/.test(term);
        if (isNumeric && term.length > 5) {
          const possibilities = [term];
          const digitsOnly = term.replace(/\D/g, '');
          
          if (!term.startsWith('+')) {
            // إضافة كود مصر كخيار افتراضي إذا بدأ بـ 0 أو كان 10 أرقام
            if (term.startsWith('0')) {
              possibilities.push('+20' + term.substring(1));
            } else {
              possibilities.push('+20' + term);
            }
            // إضافة احتمالية أن الرقم بدون أصفار أو كود
            if (digitsOnly.length >= 10) {
              possibilities.push('+' + digitsOnly);
            }
          } else {
            // إذا بدأ بـ + حاول أيضاً بدونه
            possibilities.push(digitsOnly);
          }
          
          // استخدام 'in' للبحث عن أي من هذه الاحتمالات (بحد أقصى 10)
          constraints.push(firestore.where('phone', 'in', Array.from(new Set(possibilities)).slice(0, 10)));
        } else {
          // Name prefix search
          // Note: Prefix search requires multiple constraints and doesn't play well with multiple 'where' filters easily without indexes
          constraints.push(firestore.where('name', '>=', term));
          constraints.push(firestore.where('name', '<=', term + '\uf8ff'));
          constraints.push(firestore.orderBy('name'));
        }
      } else {
        constraints.push(firestore.orderBy('createdAt', 'desc'));
      }

      // Role check
      if (!isHighRole) {
        constraints.push(firestore.where('salesAgentId', '==', user.uid));
      } else if (filterSalesAgent !== 'all') {
        constraints.push(firestore.where('salesAgentId', '==', filterSalesAgent));
      }

      // Filter checks
      if (!isSearchActive) { // Some filters might collide with range search on Name in Firestore
        if (filterStatus !== 'all') constraints.push(firestore.where('status', '==', filterStatus));
        if (filterService !== 'all') constraints.push(firestore.where('serviceId', '==', filterService));
        if (filterLaptop !== 'all') constraints.push(firestore.where('laptop', '==', filterLaptop));
        if (filterMode !== 'all') constraints.push(firestore.where('mode', '==', filterMode));
        if (filterGender !== 'all') constraints.push(firestore.where('gender', '==', filterGender));
        if (filterBookedCourse !== 'all') constraints.push(firestore.where('bookedCourseId', '==', filterBookedCourse));
        if (filterLabel !== 'all') constraints.push(firestore.where('labels', 'array-contains', filterLabel));
      }

      if (isMore && lastVisible) {
        constraints.push(firestore.startAfter(lastVisible));
      }

      constraints.push(firestore.limit(30));

      const q = firestore.query(clientsRef, ...constraints);
      const snapshot = await firestore.getDocs(q);
      
      const newClients = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Client));
      
      let finalClients: Client[];
      if (isMore) {
        finalClients = [...clients, ...newClients];
      } else {
        finalClients = newClients;
      }

      setClients(finalClients);
      const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
      setLastVisible(lastDoc);
      const more = snapshot.docs.length === 30;
      setHasMore(more);
      setTotalRead(prev => prev + snapshot.docs.length);

      // Update global cache
      clientsCache.data = finalClients;
      clientsCache.lastVisible = lastDoc;
      clientsCache.hasMore = more;
    } catch (err) {
      console.error("Error fetching clients:", err);
      // Optional: fallback to local search if query fails (maybe index missing)
    } finally {
      setIsLoadingMore(false);
    }
  };

  const filteredClients = useMemo(() => {
    // When search is active, we rely on the server-side results
    // But we can still do a secondary local filter for better feel
    if (!debouncedSearch) return clients;
    const term = debouncedSearch.toLowerCase();
    return clients.filter(c => c.name.toLowerCase().includes(term) || c.phone.includes(term));
  }, [clients, debouncedSearch]);

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isSubmitting) return;
    setIsSubmitting(true);
    
    // تنظيف الرقم وإزالة كود الدولة إذا كان مكرراً
    const cleanedPartial = cleanPhoneNumber(newClient.phone, newClient.countryCode);
    const phoneFull = newClient.countryCode + cleanedPartial;
    
    // منع التكرار
    try {
      try {
        const phoneCheck = await firestore.getDocs(firestore.query(firestore.collection(db, 'clients'), firestore.where('phone', '==', phoneFull)));
        if (!phoneCheck.empty) {
          const existingClient = phoneCheck.docs[0].data() as Client;
          setIsSubmitting(false);
          return alert(`تنبيه: هذا الرقم مسجل مسبقاً باسم: ${existingClient.name}\nومسؤول عنه الموظف: ${existingClient.salesAgentName}\n\nيرجى مراجعة الإدارة إذا كنت تود تحويله باسمك.`);
        }
      } catch (err: any) {
        // إذا فشل الفحص بسبب الصلاحيات، فهذا يعني غالباً أن الرقم موجود ولكن لموظف آخر (لأن القواعد تمنع قراءة بيانات عملاء الآخرين)
        if (err.message?.includes('permission-denied') || err.code === 'permission-denied') {
          setIsSubmitting(false);
          return alert("تنبيه: هذا الرقم مسجل مسبقاً لموظف آخر في النظام.\nلا يمكنك إضافة هذا الرقم مجدداً.\n\nيرجى التواصل مع الإدارة للتأكد.");
        }
        throw err; // إعادة رمي الخطأ إذا لم يكن متعلقاً بالصلاحيات
      }

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

      const { nextDate, nextTime, nextPeriod, scheduleNext, isBooked, bookedCourseId, bookedCourseName, totalPrice, paidAmount, remainingAmount, customServiceName, ...clientToSave } = newClient;
      
      // Validation for WhatsApp
      if (newClient.source === ClientSource.WHATSAPP && !newClient.phone.trim()) {
        setIsSubmitting(false);
        return alert("رقم الموبايل إجباري عند اختيار واتساب");
      }

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

      await firestore.addDoc(firestore.collection(db, 'clients'), dataToSave);
      
      await logActivity(user.uid, user.name, `إضافة عميل جديد (${newClient.source}): ${newClient.name}`, 'new', newClient.name);
      
      setIsSubmitting(false); // تأكيد إغلاق حالة التحميل قبل تغيير الواجهة
      setIsAddModalOpen(false);
      
      // Reset and Clear cache context so it reloads on next mount or manually reload
      clientsCache.filters = ''; 
      await fetchClients(false);
      alert("تمت إضافة العميل بنجاح!");
    } catch (err) { 
      console.error("Add Client Error:", err);
      try {
        handleFirestoreError(err, OperationType.CREATE, 'clients');
      } catch (finalErr) {
        alert("حدث خطأ أثناء إضافة العميل: " + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      setIsSubmitting(false);
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
      const transferRecord: ClientTransfer = {
        id: crypto.randomUUID(),
        clientId: selectedClient.id, clientName: selectedClient.name,
        oldAgentId: selectedClient.salesAgentId, oldAgentName: selectedClient.salesAgentName,
        newAgentId: newAgent.id, newAgentName: newAgent.name,
        reason: transferReason, timestamp: Date.now(),
        performedById: user!.uid, performedByName: user!.name
      };

      await firestore.addDoc(firestore.collection(db, 'transfers'), transferRecord);
      
      const updatedHistory = [...(selectedClient.transferHistory || []), transferRecord];

      await firestore.updateDoc(firestore.doc(db, 'clients', selectedClient.id), { 
        salesAgentId: newAgent.id, 
        salesAgentName: newAgent.name,
        transferHistory: updatedHistory
      });
      await logActivity(user!.uid, user!.name, `تحويل العميل إلى ${newAgent.name}`, selectedClient.id, selectedClient.name);
      setIsTransferModalOpen(false);
      setSelectedClient(null);
      // Refresh list to show change
      setClients(clients.map(c => c.id === selectedClient.id ? { ...c, salesAgentId: newAgent.id, salesAgentName: newAgent.name, transferHistory: updatedHistory } : c));
    } catch (err) { 
      handleFirestoreError(err, OperationType.WRITE, 'clients/transfers');
      alert("حدث خطأ في الصلاحيات أثناء تحويل العميل.");
    }
  };

  const handleBulkTransfer = async () => {
    if (!bulkTransferFrom || !bulkTransferTo) return;
    if (bulkTransferFrom === bulkTransferTo) return alert("لا يمكن التحويل لنفس الموظف");
    
    const fromAgent = salesAgents.find(a => a.id === bulkTransferFrom);
    const toAgent = salesAgents.find(a => a.id === bulkTransferTo);
    if (!fromAgent || !toAgent) return;

    if (!window.confirm(`هل أنت متأكد من تحويل جميع عملاء (${fromAgent.name}) إلى (${toAgent.name})؟`)) return;

    setIsSubmitting(true);
    try {
      const q = firestore.query(firestore.collection(db, 'clients'), firestore.where('salesAgentId', '==', fromAgent.id));
      const snapshot = await firestore.getDocs(q);
      
      if (snapshot.empty) {
        alert("هذا الموظف ليس لديه عملاء حالياً.");
        setIsSubmitting(false);
        return;
      }

      const batch = firestore.writeBatch(db);
      const timestamp = Date.now();
      const clientIds: string[] = [];
      
      snapshot.docs.forEach(docSnap => {
        const clientData = docSnap.data() as Client;
        clientIds.push(docSnap.id);
        const transferRecord: ClientTransfer = {
          id: crypto.randomUUID(),
          clientId: docSnap.id, clientName: clientData.name,
          oldAgentId: fromAgent.id, oldAgentName: fromAgent.name,
          newAgentId: toAgent.id, newAgentName: toAgent.name,
          reason: 'تحويل جماعي من قبل الإدارة', timestamp,
          performedById: user!.uid, performedByName: user!.name
        };
        
        batch.update(docSnap.ref, {
          salesAgentId: toAgent.id,
          salesAgentName: toAgent.name,
          transferHistory: firestore.arrayUnion(transferRecord)
        });
      });

      const bulkTransferRecord: Omit<BulkTransfer, 'id'> = {
        fromAgentId: fromAgent.id,
        fromAgentName: fromAgent.name,
        toAgentId: toAgent.id,
        toAgentName: toAgent.name,
        clientCount: snapshot.size,
        clientIds,
        timestamp,
        performedById: user!.uid,
        performedByName: user!.name,
        isUndone: false
      };

      await firestore.addDoc(firestore.collection(db, 'bulk_transfers'), bulkTransferRecord);
      await batch.commit();
      await logActivity(user!.uid, user!.name, `تحويل جماعي من ${fromAgent.name} إلى ${toAgent.name}`, 'bulk', `${snapshot.size} عميل`);
      
      alert(`تم تحويل ${snapshot.size} عميل بنجاح.`);
      setIsBulkTransferOpen(false);
      fetchClients(false); // Reload list
    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء التحويل الجماعي.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUndoBulkTransfer = async (bt: BulkTransfer) => {
    if (bt.isUndone) return;
    if (!window.confirm(`هل أنت متأكد من التراجع عن تحويل ${bt.clientCount} عميل من ${bt.toAgentName} وإعادتهم إلى ${bt.fromAgentName}؟`)) return;

    setIsUndoing(true);
    try {
      const batch = firestore.writeBatch(db);
      const timestamp = Date.now();

      // We need to fetch the clients to make sure they still exist and are currently assigned to 'bt.toAgentId'
      // Or we can just try to update them if they match.
      // Better fetch for safety to avoid overwriting newer manual transfers if any occurred since then.
      // But for "Comprehensive Undo", the user expects them to go back.
      
      for (const cid of bt.clientIds) {
        const clientRef = firestore.doc(db, 'clients', cid);
        const clientSnap = await firestore.getDoc(clientRef);
        
        if (clientSnap.exists()) {
          const clientData = clientSnap.data() as Client;
          
          // Only undo if they are still with the agent we transferred them to
          if (clientData.salesAgentId === bt.toAgentId) {
            const transferRecord: ClientTransfer = {
              id: crypto.randomUUID(),
              clientId: cid, clientName: clientData.name,
              oldAgentId: bt.toAgentId, oldAgentName: bt.toAgentName,
              newAgentId: bt.fromAgentId, newAgentName: bt.fromAgentName,
              reason: 'تراجع عن تحويل جماعي', timestamp,
              performedById: user!.uid, performedByName: user!.name
            };

            batch.update(clientRef, {
              salesAgentId: bt.fromAgentId,
              salesAgentName: bt.fromAgentName,
              transferHistory: firestore.arrayUnion(transferRecord)
            });
          }
        }
      }

      batch.update(firestore.doc(db, 'bulk_transfers', bt.id), { isUndone: true });
      await batch.commit();
      await logActivity(user!.uid, user!.name, `تراجع عن تحويل جماعي (${bt.clientCount} عميل)`, bt.id, `من ${bt.toAgentName} إلى ${bt.fromAgentName}`);
      
      alert("تم التراجع عن التحويل بنجاح.");
      fetchClients(false);
    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء التراجع عن التحويل.");
    } finally {
      setIsUndoing(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">قائمة <span className="text-primary-500">العملاء</span></h1>
          <p className="text-slate-500 font-bold mt-1">إدارة بيانات المتقدمين والمتابعات (المحمل: {clients.length})</p>
        </div>
        <div className="flex gap-2">
          {canDelete && (
            <button onClick={() => setIsBulkTransferOpen(true)} className="bg-amber-500 text-white px-6 py-4 rounded-3xl font-black text-xs uppercase shadow-xl hover:bg-amber-600 transition-all flex items-center gap-2">
              <Layers size={18} /> تحويل جماعي
            </button>
          )}
          <button onClick={() => setIsAddModalOpen(true)} className="bg-primary-500 text-white px-8 py-4 rounded-3xl font-black text-xs uppercase shadow-xl hover:bg-primary-600 transition-all flex items-center gap-2">
            <Plus size={18} /> إضافة عميل جديد
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-xl border border-slate-100 dark:border-slate-800 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
            <select className="bg-slate-50 dark:bg-slate-800 px-6 py-4 rounded-2xl font-black text-xs text-slate-500 outline-none dark:text-slate-300" value={filterLabel} onChange={e => setFilterLabel(e.target.value)}>
              <option value="all">كل التصنيفات (Labels)</option>
              {allLabels.map(l => <option key={l.id} value={l.id}>{l.text}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            {isHighRole ? (
               <select className="bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-xl font-bold text-[10px] text-slate-500 outline-none dark:text-slate-300" value={filterSalesAgent} onChange={e => setFilterSalesAgent(e.target.value)}>
                <option value="all">كل السيلز</option>
                {salesAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            ) : (
              <div className="bg-slate-50/50 dark:bg-slate-800/50 px-4 py-3 rounded-xl font-bold text-[10px] text-slate-400 flex items-center justify-center">
                فلترة متقدمة
              </div>
            )}
            
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
                    <div className="flex items-center gap-3">
                      <div className="shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-primary-500">
                        {client.source === ClientSource.WHATSAPP && <MessageCircle size={16}/>}
                        {client.source === ClientSource.MESSENGER && <MessageSquare size={16}/>}
                        {(client.source === ClientSource.FACEBOOK || client.source === ClientSource.TIKTOK) && <Globe size={16}/>}
                        {client.source === ClientSource.OTHER && <Layers size={16}/>}
                      </div>
                      <div>
                        <p onClick={() => navigate(`/clients/${client.id}`)} className="font-black text-sm text-slate-900 dark:text-white cursor-pointer hover:text-primary-500">{client.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-[9px] font-black text-slate-400 flex items-center gap-1">
                            <Clock size={10}/> {new Date(client.createdAt).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </p>
                          {client.profileLink && (
                            <a href={client.profileLink} target="_blank" className="text-blue-500 hover:underline flex items-center gap-0.5 text-[8px] font-black">
                              <ExternalLink size={8}/> الرابط
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
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
                    {client.labels && client.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {client.labels.map(labelId => {
                          const label = allLabels.find(l => l.id === labelId);
                          if (!label) return null;
                          return (
                            <span 
                              key={labelId} 
                              className="px-2 py-0.5 rounded text-[7px] font-black"
                              style={{ backgroundColor: `${label.color}20`, color: label.color, border: `1px solid ${label.color}40` }}
                            >
                              {label.text}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-8 py-6 text-center text-[10px] text-slate-500 font-bold italic">{client.salesAgentName}</td>
                  <td className="px-8 py-6">
                    <div className="flex justify-center gap-2">
                      <ContactButtons phone={client.phone} iconSize={16} />
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
                              // Remove from local state and cache
                              setClients(prev => prev.filter(c => c.id !== client.id));
                              clientsCache.data = clientsCache.data.filter(c => c.id !== client.id);
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
        
        {hasMore && (
          <div className="p-8 flex justify-center bg-slate-50/50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800">
            <button 
              onClick={() => fetchClients(true)} 
              disabled={isLoadingMore}
              className="bg-white dark:bg-slate-900 px-10 py-4 rounded-2xl font-black text-xs shadow-md hover:shadow-lg transition-all border border-slate-100 dark:border-slate-800 flex items-center gap-2"
            >
              {isLoadingMore ? 'جاري التحميل...' : 'تحميل المزيد من العملاء'}
            </button>
          </div>
        )}
      </div>

      {/* Add Client Panel */}
      <FloatingPanel 
        isOpen={isAddModalOpen} 
        onClose={() => setIsAddModalOpen(false)} 
        title="إضافة عميل جديد"
        icon={<Plus size={24} />}
      >
        <form onSubmit={handleAddClient} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">المنصة (Source)</label>
              <select required className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={newClient.source} onChange={e => setNewClient({...newClient, source: e.target.value as ClientSource})}>
                {Object.entries(SourceLabels).map(([k,v]) => <option key={k} value={k}>{v.ar}</option>)}
              </select>
            </div>
            {newClient.source !== ClientSource.WHATSAPP && (
              <div className="space-y-1.5 animate-fade-in">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2">رابط الحساب (Link)</label>
                <input className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold dark:text-white" placeholder="https://facebook.com/..." value={newClient.profileLink} onChange={e => setNewClient({...newClient, profileLink: e.target.value})} />
              </div>
            )}
          </div>

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

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">رقم الهاتف ({newClient.source === ClientSource.WHATSAPP ? 'إجباري' : 'اختياري'})</label>
              <div className="relative group">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 transition-colors group-focus-within:text-primary-500" dir="ltr">
                  {newClient.countryCode || <Globe size={14} className="opacity-50"/>}
                </span>
                <input 
                  required={newClient.source === ClientSource.WHATSAPP} 
                  className="w-full p-4 pl-16 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold text-right dark:text-white border-2 border-transparent focus:border-primary-500/20 transition-all" 
                  dir="ltr" 
                  type="tel"
                  placeholder="مثال: 01012345678 أو +2010..." 
                  value={newClient.phone} 
                  onChange={e => handlePhoneChange(e.target.value)} 
                  onPaste={(e) => {
                    setTimeout(() => {
                      const input = e.target as HTMLInputElement;
                      handlePhoneChange(input.value);
                    }, 0);
                  }}
                />
              </div>
              {newClient.country && !showCountrySelector && (
                <p className="text-[10px] font-bold text-primary-500 mt-1 mr-2 animate-fade-in flex items-center gap-1">
                  <Globe size={10}/> دولة العميل: {newClient.country} ({newClient.countryCode})
                  <button type="button" onClick={() => setShowCountrySelector(true)} className="mr-2 text-slate-400 underline hover:text-slate-600 transition-colors">تغيير</button>
                </p>
              )}
            </div>

            {showCountrySelector && (
              <div className="space-y-1.5 animate-fade-in">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2">اختر الدولة (لإضافة كود الدولة تلقائياً)</label>
                <div className="flex gap-2">
                  <select className="flex-1 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white border-2 border-primary-500/10" value={newClient.country} onChange={e => {
                    const country = ARAB_COUNTRIES.find(c => c.name === e.target.value);
                    setNewClient({...newClient, country: e.target.value, countryCode: country?.code || ''});
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

          <button 
            type="submit" 
            disabled={isSubmitting}
            className={`w-full py-5 rounded-3xl font-black shadow-xl transition-all uppercase text-xs ${isSubmitting ? 'bg-slate-400 cursor-not-allowed' : 'bg-primary-500 hover:bg-primary-600 text-white'}`}
          >
            {isSubmitting ? 'جاري التسجيل...' : 'إضافة العميل وتوثيق وقت التسجيل'}
          </button>
        </form>
      </FloatingPanel>

      {/* Transfer Panel */}
      <FloatingPanel
        isOpen={isTransferModalOpen && !!selectedClient}
        onClose={() => { setIsTransferModalOpen(false); setSelectedClient(null); }}
        title="تحويل العميل"
        icon={<ArrowRightLeft className="text-amber-500"/>}
        width="max-w-lg"
      >
        {selectedClient && (
          <div className="space-y-6">
            <p className="text-sm font-bold text-slate-500 leading-relaxed">تحويل <span className="text-primary-500 font-black">{selectedClient.name}</span> لموظف آخر ليتمكن من متابعته:</p>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2">اختر الموظف الجديد</label>
                <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={transferAgentId} onChange={e => setTransferAgentId(e.target.value)}>
                  <option value="">اختر الموظف...</option>
                  {salesAgents.filter(a => a.id !== selectedClient.salesAgentId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2">سبب التحويل</label>
                <textarea placeholder="اكتب هنا سبب التحويل (مثال: العميل طلب التواصل مع شخص معين)..." className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none h-32 dark:text-white" value={transferReason} onChange={e => setTransferReason(e.target.value)} />
              </div>
              <button onClick={handleTransfer} className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:shadow-primary-500/20 active:scale-95 transition-all">تأكيد التحويل الآن</button>
            </div>
          </div>
        )}
      </FloatingPanel>

      {/* Bulk Transfer Panel */}
      <FloatingPanel
        isOpen={isBulkTransferOpen}
        onClose={() => setIsBulkTransferOpen(false)}
        title="تحويل جماعي للعملاء"
        icon={<Layers className="text-amber-500"/>}
        width="max-w-xl"
      >
        <div className="space-y-6">
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">تحويل من (الموظف الحالي)</label>
              <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={bulkTransferFrom} onChange={e => setBulkTransferFrom(e.target.value)}>
                <option value="">اختر الموظف الذي لديه العملاء حالياً...</option>
                {salesAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">تحويل إلى (الموظف الجديد)</label>
              <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={bulkTransferTo} onChange={e => setBulkTransferTo(e.target.value)}>
                <option value="">اختر الموظف الذي سيستلم العملاء...</option>
                {salesAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>

            <div className="p-5 bg-rose-50 dark:bg-rose-500/10 rounded-2xl border border-rose-100 dark:border-rose-500/20">
              <p className="text-[10px] font-black text-rose-600 text-center uppercase flex items-center justify-center gap-2">
                <AlertTriangle size={14}/> تنبيه: سيتم تحويل جميع عملاء هذا الموظف فوراً وبشكل جماعي.
              </p>
            </div>

            <button 
              onClick={handleBulkTransfer} 
              className="w-full py-5 bg-amber-500 text-white rounded-3xl font-black shadow-xl hover:bg-amber-600 transition-all flex items-center justify-center gap-2 active:scale-95"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'جاري التحويل الجماعي...' : (
                <>
                  <ArrowRightLeft size={20}/> تنفيذ التحويل الجماعي
                </>
              )}
            </button>
          </div>

          {recentBulkTransfers.length > 0 && (
            <div className="pt-8 border-t border-slate-100 dark:border-slate-800 space-y-4">
              <h3 className="text-xs font-black uppercase text-slate-400 flex items-center gap-2 tracking-widest">
                <History size={14}/> آخر التحويلات الجماعية المنفذة
              </h3>
              <div className="space-y-4">
                {recentBulkTransfers.map(bt => (
                  <div key={bt.id} className={`p-5 rounded-[1.5rem] border ${bt.isUndone ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800 opacity-60' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 shadow-sm'}`}>
                    <div className="flex justify-between items-start mb-3">
                      <div className="text-[10px] font-black text-slate-400">
                        {new Date(bt.timestamp).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      {bt.isUndone ? (
                        <span className="text-[8px] font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full uppercase">تم التراجع</span>
                      ) : (
                        <button 
                          onClick={() => handleUndoBulkTransfer(bt)}
                          disabled={isUndoing}
                          className="text-[9px] font-black text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 px-2 py-1 rounded-lg uppercase flex items-center gap-1 transition-all"
                        >
                          <History size={10}/> تراجع عن العملية
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm font-black text-slate-600 dark:text-slate-300">
                      <span className="text-primary-500">{bt.fromAgentName}</span>
                      <ArrowRightLeft size={12} className="text-slate-300"/>
                      <span className="text-amber-500">{bt.toAgentName}</span>
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 mt-2">تم تحويل <span className="text-slate-600 dark:text-slate-200">{bt.clientCount}</span> عميل بواسطة {bt.performedByName}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </FloatingPanel>
    </div>
  );
};

export default ClientsList;
