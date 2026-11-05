
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as firestore from 'firebase/firestore';
import { db, logActivity, handleFirestoreError, OperationType } from '../firebase';
import { sendMetaEvent } from '../metaService';
import { useAuth } from '../App';
import { 
  Client, ClientStatus, StatusLabels, UserRole, Service, Label, 
  ClientTransfer, BulkTransfer, CommMethod, CommMethodLabels, Gender, LaptopStatus, AttendanceMode,
  ClientSource, SourceLabels
} from '../types';
import FloatingPanel from '../components/FloatingPanel';
// Loaded only when opened (it carries the Excel library).
const BulkImportModal = React.lazy(() => import('../components/BulkImportModal').then((m) => ({ default: m.BulkImportModal })));
import AcceptFlowModal from '../components/AcceptFlowModal';
import { getLabelColorStyle } from '../utils/labelColors';
import { 
  Plus, Search, MessageCircle, History, ArrowRightLeft, Trash2,
  Phone, MessageSquare, User, Clock, X,
  ExternalLink, Layers, AlertTriangle, Upload, Download, Sparkles,
  SlidersHorizontal, ChevronDown, Facebook, Instagram, Music2, Globe2, UserPlus, MoreHorizontal } from 'lucide-react';
import { PageHeader } from '../components/ui';
import { POOL_AGENT_EMAIL } from '../utils/poolAgent';
import { searchTerm as toSearchKey, matchesSearch, buildSearchKeys } from '../utils/searchKeys.mjs';
import { usePagedQuery } from '../utils/usePagedQuery';
import { useServices, useLabels, useAgentOptions, useStaff } from '../utils/refData';
import Pager from '../components/Pager';
import FilterPanel, { Field } from '../components/FilterPanel';
import { normalizePhoneKey } from '../utils/clientMerge.mjs';
import { buildChatwootConversationLink } from '../utils/chatwoot';
import { 
  CURRENCY_LABELS, fetchExchangeRates, calculateExternalTransfer 
} from '../utils/currency';

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

const getClientSourceMeta = (source?: ClientSource) => {
  switch (source) {
    case ClientSource.WHATSAPP:
      return { label: 'واتساب', Icon: MessageCircle, box: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' };
    case ClientSource.MESSENGER:
      return { label: 'ماسينجر', Icon: MessageSquare, box: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400' };
    case ClientSource.FACEBOOK:
      return { label: 'فيسبوك', Icon: Facebook, box: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' };
    case ClientSource.INSTAGRAM:
      return { label: 'انستجرام', Icon: Instagram, box: 'bg-pink-50 text-pink-600 dark:bg-pink-500/10 dark:text-pink-400' };
    case ClientSource.TIKTOK:
      return { label: 'تيك توك', Icon: Music2, box: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200' };
    case ClientSource.GOOGLE:
      return { label: 'جوجل', Icon: Globe2, box: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' };
    default:
      return { label: 'أخرى', Icon: Layers, box: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };
  }
};

const ClientsList: React.FC = () => {
  const { user, effectiveRole, effectiveUser, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  // Reference data comes from the shared session store (read once, not on every visit).
  const services = useServices(true);
  const allLabels = useLabels();
  const salesAgents = useAgentOptions();
  const staff = useStaff();
  
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
  const [filterTransferType, setFilterTransferType] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'createdAt' | 'lastChatwootContactAsc'>('createdAt');
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchExchangeRates().then(rates => setExchangeRates(rates));
  }, []);

  // The shared "Saber Group" pool account, found in the staff list (no extra read).
  const poolAgentId = useMemo(() => staff.find(u => (u.email || '').toLowerCase() === POOL_AGENT_EMAIL.toLowerCase())?.uid || null, [staff]);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [acceptFlowClient, setAcceptFlowClient] = useState<Client | null>(null);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
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
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [newClient, setNewClient] = useState({ 
    name: '', position: '', phone: '', status: ClientStatus.INTERESTED,
    source: ClientSource.WHATSAPP, profileLink: '',
    gender: Gender.MALE, laptop: LaptopStatus.WITHOUT, mode: AttendanceMode.OFFLINE,
    serviceId: '', customServiceName: '', country: 'مصر', countryCode: '+20', 
    labels: [] as string[],
    notes: '',
    preferredMethod: CommMethod.PHONE,
    hasLastFollowUp: false,
    lastFollowUpDate: '',
    lastFollowUpTime: '10:00',
    lastFollowUpPeriod: 'AM' as 'AM' | 'PM',
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
    remainingAmount: 0,
    isExternalTransfer: false,
    originalCurrency: 'USD',
    originalTotalPrice: 0,
    originalPaidAmount: 0,
    exchangeRateUsed: 48.5,
    deductionAmount: 0,
    deductionReason: '٣٪ عمولة تحويل و ١٤٪ ضرايب',
    assignedSalesAgentId: '',
    chatId: ''
  });

  const handlePhoneChange = (val: string) => {
    // Remove spaces and any non-numeric/plus characters
    let cleaned = val.replace(/[\s\(\)\-]/g, '');
    
    // Auto-detect country code if it starts with + or 00
    if (cleaned.startsWith('+') || cleaned.startsWith('00')) {
      const normalized = cleaned.startsWith('00') ? '+' + cleaned.substring(2) : cleaned;
      
      // Match against known arab countries
      for (const country of ARAB_COUNTRIES) {
        if (country.code && normalized.startsWith(country.code)) {
          const phonePart = normalized.substring(country.code.length);
          // Special case for Egypt: if starts with 1... and code is +20, maybe we want to keep it or add 0
          let finalPhone = phonePart;
          if (country.code === '+20' && phonePart.startsWith('1') && phonePart.length === 10) {
            finalPhone = '0' + phonePart;
          }
          
          setNewClient(prev => ({ 
            ...prev, 
            phone: finalPhone, 
            country: country.name, 
            countryCode: country.code 
          }));
          return;
        }
      }
    }
    
    setNewClient(prev => ({ ...prev, phone: cleaned }));
  };

  const isHighRole = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.SUPERVISOR || effectiveRole === UserRole.MANAGER || effectiveRole === UserRole.TEAM_LEADER;
  const isAdmin = user?.role === UserRole.ADMIN;
  const canDelete = isAdmin;
  const canBulkTransfer = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER;
  const canEditChatId = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.SUPERVISOR;
  const UNASSIGNED_AGENT = '__unassigned__';

  // The header search box sends ?q=... here.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const q = searchParams.get('q');
    if (q === null) return;
    setSearchTerm(q);
    setSearchParams({}, { replace: true });
  }, [searchParams]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 600);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Recent bulk transfers (leaders): 5 docs.
  useEffect(() => {
    if (authLoading || !user || !isHighRole) return;
    return firestore.onSnapshot(
      firestore.query(firestore.collection(db, 'bulk_transfers'), firestore.orderBy('timestamp', 'desc'), firestore.limit(5)),
      snap => setRecentBulkTransfers(snap.docs.map(d => ({ id: d.id, ...d.data() } as BulkTransfer))),
      err => console.error('Bulk transfers listener failed:', err),
    );
  }, [authLoading, user?.uid, isHighRole]);

  // The list: 10 clients per page, read page by page (see usePagedQuery).
  const isSearchActive = debouncedSearch.trim().length > 0;
  const scopedId = effectiveUser?.uid || user?.uid || '';
  const listQuery = useMemo(() => {
    if (authLoading || !user) return { constraints: null, key: '' };
    // Sales reps also see clients still on the shared pool account; wait for the staff list
    // so the query is built once with the right ids.
    if (!isHighRole && staff.length === 0) return { constraints: null, key: '' };
    const c: firestore.QueryConstraint[] = [];
    if (isSearchActive) {
      // Indexed search: searchKeys holds the start of every name word and the last 4-10 phone
      // digits, so one array-contains query finds "حسن" inside "أسماء حسن" or a number by its tail.
      c.push(firestore.where('searchKeys', 'array-contains', toSearchKey(debouncedSearch) || '\u0000'));
    }
    if (!isHighRole) {
      c.push(firestore.where('salesAgentId', 'in', poolAgentId ? [scopedId, poolAgentId] : [scopedId]));
    } else if (filterSalesAgent !== 'all') {
      c.push(firestore.where('salesAgentId', '==', filterSalesAgent));
    }
    if (!isSearchActive) {
      if (filterStatus !== 'all') c.push(firestore.where('status', '==', filterStatus));
      if (filterService !== 'all') c.push(firestore.where('serviceId', '==', filterService));
      if (filterLaptop !== 'all') c.push(firestore.where('laptop', '==', filterLaptop));
      if (filterMode !== 'all') c.push(firestore.where('mode', '==', filterMode));
      if (filterGender !== 'all') c.push(firestore.where('gender', '==', filterGender));
      if (filterBookedCourse !== 'all') c.push(firestore.where('bookedCourseId', '==', filterBookedCourse));
      if (filterLabel !== 'all') c.push(firestore.where('labels', 'array-contains', filterLabel));
      if (filterTransferType === 'external') c.push(firestore.where('isExternalTransfer', '==', true));
    }
    const key = JSON.stringify([effectiveRole, scopedId, poolAgentId, debouncedSearch, sortBy, filterSalesAgent, filterStatus, filterService, filterLaptop, filterMode, filterGender, filterBookedCourse, filterLabel, filterTransferType]);
    return { constraints: c, key };
  }, [authLoading, user?.uid, isHighRole, staff.length, poolAgentId, scopedId, effectiveRole, debouncedSearch, sortBy, filterSalesAgent, filterStatus, filterService, filterLaptop, filterMode, filterGender, filterBookedCourse, filterLabel, filterTransferType]);

  const paged = usePagedQuery<Client>({
    collectionName: 'clients',
    constraints: listQuery.constraints,
    queryKey: listQuery.key,
    // Search keeps Firestore's own order (no extra index); otherwise newest first or oldest Chatwoot contact.
    orderField: isSearchActive ? null : sortBy === 'lastChatwootContactAsc' ? 'lastChatwootContactAt' : 'createdAt',
    orderDirection: sortBy === 'lastChatwootContactAsc' ? 'asc' : 'desc',
  });
  const clients = paged.rows;

  const filteredClients = useMemo(() => {
    let result = clients;
    if (debouncedSearch) {
      const term = debouncedSearch.toLowerCase();
      result = result.filter(c => matchesSearch(c, term));
    }
    // "Local payment" has no server-side field to match (most clients lack the flag), so it
    // only hides external transfers on the page being shown.
    if (filterTransferType === 'local') result = result.filter(c => !c.isExternalTransfer);
    return result;
  }, [clients, debouncedSearch, filterTransferType]);

  const resetFilters = () => {
    setSearchTerm(''); setFilterStatus('all'); setFilterService('all'); setFilterSalesAgent('all'); setSortBy('createdAt');
    setFilterLabel('all'); setFilterBookedCourse('all'); setFilterLaptop('all'); setFilterMode('all'); setFilterGender('all'); setFilterTransferType('all');
  };

  // Export reads the booked clients in the user's scope once, on demand (the list itself only
  // holds the page on screen).
  const [isExporting, setIsExporting] = useState(false);
  const exportBookings = async () => {
    if (!user || isExporting) return;
    setIsExporting(true);
    try {
      const c: firestore.QueryConstraint[] = [firestore.where('status', '==', ClientStatus.BOOKED)];
      if (!isHighRole) c.push(firestore.where('salesAgentId', 'in', poolAgentId ? [scopedId, poolAgentId] : [scopedId]));
      else if (filterSalesAgent !== 'all') c.push(firestore.where('salesAgentId', '==', filterSalesAgent));
      const snap = await firestore.getDocs(firestore.query(firestore.collection(db, 'clients'), ...c));
      const { exportBookingsToExcel } = await import('../utils/exportClients');
      exportBookingsToExcel(snap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
    } catch (err) {
      console.error('Export failed:', err);
      alert('تعذر التصدير. حاول مرة أخرى.');
    } finally {
      setIsExporting(false);
    }
  };

  const selectedClientSet = useMemo(() => new Set(selectedClientIds), [selectedClientIds]);
  const selectedClients = useMemo(
    () => clients.filter(client => selectedClientSet.has(client.id)),
    [clients, selectedClientSet]
  );
  const allVisibleSelected = filteredClients.length > 0 && filteredClients.every(client => selectedClientSet.has(client.id));
  const advancedFiltersCount = useMemo(() => (
    [filterLabel, filterBookedCourse, filterLaptop, filterMode, filterGender, filterTransferType]
      .filter(value => value !== 'all').length
  ), [filterLabel, filterBookedCourse, filterLaptop, filterMode, filterGender, filterTransferType]);


  useEffect(() => {
    const visibleClientIds = new Set(filteredClients.map(client => client.id));
    setSelectedClientIds(prev => prev.filter(id => visibleClientIds.has(id)));
  }, [filteredClients]);

  const toggleClientSelection = (clientId: string) => {
    setSelectedClientIds(prev => (
      prev.includes(clientId)
        ? prev.filter(id => id !== clientId)
        : [...prev, clientId]
    ));
  };

  const toggleVisibleSelection = () => {
    const visibleIds = filteredClients.map(client => client.id);
    setSelectedClientIds(prev => {
      if (allVisibleSelected) {
        return prev.filter(id => !visibleIds.includes(id));
      }
      return Array.from(new Set([...prev, ...visibleIds]));
    });
  };

  const buildLocalTimestamp = (date: string, time: string, period: 'AM' | 'PM') => {
    if (!date) return 0;
    const [h, m] = time.split(':').map(Number);
    const finalH = period === 'PM' && h < 12 ? h + 12 : (period === 'AM' && h === 12 ? 0 : h);
    const dateObj = new Date(date);
    dateObj.setHours(finalH || 0, m || 0, 0, 0);
    return dateObj.getTime();
  };

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isSubmitting) return;
    setIsSubmitting(true);
    
    const phoneFull = newClient.countryCode + newClient.phone.replace(/^0+/, '').trim();
    
    // منع التكرار - التحويل لعدة صيغ لضمان عدم التكرار
    try {
      const digitsOnly = phoneFull.replace(/\D/g, '');
      const phoneVariations = [phoneFull, digitsOnly];
      
      // إذا كان الرقم مصري، نضيف احتمالات أخرى للتأكد
      if (phoneFull.startsWith('+20')) {
        const core = phoneFull.substring(3); // مثلا 1012345678
        phoneVariations.push('0' + core);    // 010...
        phoneVariations.push(core);         // 10...
        phoneVariations.push('20' + core);  // 2010...
      } else if (digitsOnly.startsWith('20')) {
        const core = digitsOnly.substring(2);
        phoneVariations.push('+20' + core);
        phoneVariations.push('0' + core);
        phoneVariations.push(core);
      }
      
      // إزالة التكرار من المصفوفة
      const uniqueVariations = Array.from(new Set(phoneVariations)).slice(0, 10);

      // One indexed lookup on the normalized phone (same key the accounting sync uses).
      const phoneKey = normalizePhoneKey(phoneFull);
      const phoneCheck = await firestore.getDocs(firestore.query(
        firestore.collection(db, 'clients'),
        phoneKey ? firestore.where('phoneKey', '==', phoneKey) : firestore.where('phone', 'in', uniqueVariations),
        firestore.limit(1)
      ));

      if (!phoneCheck.empty) {
        const existingClient = phoneCheck.docs[0].data() as Client;
        const regDate = new Date(existingClient.createdAt).toLocaleDateString('ar-EG');
        setIsSubmitting(false);
        
        return alert(
          `تنبيه: هذا الرقم مسجل مسبقاً لموظف آخر في النظام.\n\n` +
          `• اسم العميل: ${existingClient.name}\n` +
          `• الموظف المسؤول: ${existingClient.salesAgentName}\n` +
          `• الحالة الحالية: ${StatusLabels[existingClient.status]?.ar || existingClient.status}\n` +
          `• تاريخ التسجيل: ${regDate}\n\n` +
          `لا يمكنك إضافة هذا الرقم مجدداً.\n` +
          `يرجى التقاط سكرين شوت والتواصل مع الإدارة (الأدمن) لمراجعة بيانات العميل أو تحويله إليك.`
        );
      }

      const isOtherService = newClient.serviceId === 'other';
      const serviceName = isOtherService ? newClient.customServiceName : (services.find(s => s.id === newClient.serviceId)?.name || 'أخرى');

      let nextTs = 0;
      if (newClient.scheduleNext && newClient.nextDate) {
        nextTs = buildLocalTimestamp(newClient.nextDate, newClient.nextTime, newClient.nextPeriod);
      }

      const lastFollowUpTs = newClient.hasLastFollowUp
        ? buildLocalTimestamp(newClient.lastFollowUpDate, newClient.lastFollowUpTime, newClient.lastFollowUpPeriod)
        : 0;

      const { 
        hasLastFollowUp, lastFollowUpDate, lastFollowUpTime, lastFollowUpPeriod,
        nextDate, nextTime, nextPeriod, scheduleNext, isBooked, bookedCourseId, bookedCourseName, 
        totalPrice, paidAmount, remainingAmount, customServiceName,
        isExternalTransfer, originalCurrency, originalTotalPrice, originalPaidAmount,
        exchangeRateUsed, deductionAmount, deductionReason, assignedSalesAgentId,
        ...clientToSave 
      } = newClient;
      
      // Validation for WhatsApp
      if (newClient.source === ClientSource.WHATSAPP && !newClient.phone.trim()) {
        setIsSubmitting(false);
        return alert("رقم الموبايل إجباري عند اختيار واتساب");
      }

      let targetAgentId = user.uid;
      let targetAgentName = user.name;

      if (isHighRole && assignedSalesAgentId === UNASSIGNED_AGENT) {
        targetAgentId = '';
        targetAgentName = 'لم يتم تحديد المسؤول بعد';
      } else if (isHighRole && assignedSalesAgentId) {
        const selectedAgent = salesAgents.find(a => a.id === assignedSalesAgentId);
        if (selectedAgent) {
          targetAgentId = selectedAgent.id;
          targetAgentName = selectedAgent.name;
        }
      }

      const dataToSave: any = {
        ...clientToSave,
        phone: phoneFull,
        serviceName,
        nextFollowUpDate: nextTs,
        salesAgentId: targetAgentId,
        salesAgentName: targetAgentName,
        createdAt: Date.now(),
        createdVia: 'manual',
        reviewedBySales: true,
      };
      
      if (nextTs) {
        dataToSave.nextFollowUpMethod = newClient.nextFollowUpMethod;
      }

      if (lastFollowUpTs) {
        dataToSave.lastFollowUpDate = lastFollowUpTs;
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

        if (isExternalTransfer) {
          dataToSave.isExternalTransfer = true;
          dataToSave.originalCurrency = originalCurrency;
          dataToSave.originalTotalPrice = originalTotalPrice;
          dataToSave.originalPaidAmount = originalPaidAmount;
          dataToSave.exchangeRateUsed = exchangeRateUsed;
          dataToSave.deductionAmount = deductionAmount;
          dataToSave.deductionReason = deductionReason;
        }
      }

      // Search index fields (see utils/searchKeys): word starts of the name + phone tail.
      dataToSave.searchKeys = buildSearchKeys(dataToSave.name, dataToSave.phone);
      dataToSave.phoneKey = normalizePhoneKey(dataToSave.phone);
      dataToSave.phoneKeys = dataToSave.phoneKey ? [dataToSave.phoneKey] : [];
      await firestore.addDoc(firestore.collection(db, 'clients'), dataToSave);
      console.log("Client added successfully");
      await logActivity(user.uid, user.name, `إضافة عميل جديد (${newClient.source}): ${newClient.name}`, 'new', newClient.name);
      sendMetaEvent({
        eventName: isBooked ? 'Purchase' : 'Lead',
        phone: phoneFull,
        value: isBooked ? (paidAmount || totalPrice || 0) : undefined,
        currency: isBooked ? 'EGP' : undefined,
        contentName: isBooked ? bookedCourseName : newClient.name,
        contentCategory: newClient.source,
      });
      setIsAddModalOpen(false);
      // Reset and Clear cache context so it reloads on next mount or manually reload
      paged.reload();
    } catch (err) { 
      handleFirestoreError(err, OperationType.CREATE, 'clients');
      alert("حدث خطأ في الصلاحيات أثناء إضافة العميل. يرجى التأكد من إعدادات Firebase.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!user || !isAdmin) {
      alert("الحذف الجماعي متاح للأدمن فقط.");
      return;
    }

    if (selectedClientIds.length === 0) {
      alert("اختر عميل واحد على الأقل للحذف.");
      return;
    }

    const confirmation = prompt(`أنت على وشك حذف ${selectedClientIds.length} عميل نهائياً. يرجى كتابة كلمة 'delete' للتأكيد:`);
    if (confirmation !== 'delete') {
      if (confirmation !== null) alert("كلمة التأكيد غير صحيحة، لم يتم الحذف.");
      return;
    }

    setIsBulkDeleting(true);
    const idsToDelete = [...selectedClientIds];
    const idsToDeleteSet = new Set(idsToDelete);

    try {
      for (let i = 0; i < idsToDelete.length; i += 450) {
        const batch = firestore.writeBatch(db);
        idsToDelete.slice(i, i + 450).forEach(clientId => {
          batch.delete(firestore.doc(db, 'clients', clientId));
        });
        await batch.commit();
      }

      const deletedNames = selectedClients.slice(0, 5).map(client => client.name).join('، ');
      await logActivity(
        user.uid,
        user.name,
        `حذف جماعي نهائي (${idsToDelete.length} عميل)`,
        'bulk-delete',
        deletedNames || `${idsToDelete.length} عميل`
      );

      paged.reload();
      setSelectedClientIds([]);
      alert(`تم حذف ${idsToDelete.length} عميل بنجاح.`);
    } catch (error) {
      console.error("Error bulk deleting clients:", error);
      alert("حدث خطأ أثناء الحذف الجماعي. يرجى التحقق من صلاحيات الأدمن.");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const updateRemaining = (total: number, paid: number) => {
    setNewClient(prev => ({ ...prev, totalPrice: total, paidAmount: paid, remainingAmount: total - paid }));
  };

  const updateExternalBooking = (
    isExt: boolean, 
    currency: string, 
    origTotal: number, 
    origPaid: number, 
    rateOverride?: number
  ) => {
    const rate = rateOverride !== undefined ? rateOverride : (exchangeRates[currency] || 1);
    
    if (isExt) {
      const result = calculateExternalTransfer(origTotal, origPaid, currency, rate);
      setNewClient(prev => ({
        ...prev,
        isExternalTransfer: true,
        originalCurrency: currency,
        originalTotalPrice: origTotal,
        originalPaidAmount: origPaid,
        exchangeRateUsed: rate,
        deductionAmount: result.deductionPaid,
        deductionReason: result.deductionReason,
        totalPrice: result.finalTotal,
        paidAmount: result.finalPaid,
        remainingAmount: result.finalRemaining
      }));
    } else {
      setNewClient(prev => ({
        ...prev,
        isExternalTransfer: false,
        totalPrice: origTotal,
        paidAmount: origPaid,
        remainingAmount: origTotal - origPaid
      }));
    }
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
      paged.patchRow(selectedClient.id, { salesAgentId: newAgent.id, salesAgentName: newAgent.name, transferHistory: updatedHistory } as Partial<Client>);
    } catch (err) { 
      handleFirestoreError(err, OperationType.WRITE, 'clients/transfers');
      alert("حدث خطأ في الصلاحيات أثناء تحويل العميل.");
    }
  };

  const handleAssignToMe = async (client: Client) => {
    if (!user) return;
    try {
      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), {
        salesAgentId: user.uid,
        salesAgentName: user.name,
      });
      await logActivity(user.uid, user.name, 'تعيين عميل لنفسه من حساب Saber Group المشترك', client.id, client.name);
      paged.patchRow(client.id, { salesAgentId: user.uid, salesAgentName: user.name });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'clients/assign-to-me');
      alert('حدث خطأ أثناء تعيين العميل.');
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
      paged.reload();
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
      paged.reload();
    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء التراجع عن التحويل.");
    } finally {
      setIsUndoing(false);
    }
  };

  return (
    <div className="sg-page space-y-6 animate-fade-in">
      <PageHeader
        title="العملاء"
        subtitle={<>بيانات المتقدمين والمتابعات{paged.total !== null && <> · <span className="sgui-count">{paged.total.toLocaleString('ar-EG')}</span> عميل</>}</>}
        actions={<>
          <button onClick={() => setIsAddModalOpen(true)} className="sgui-button is-primary">
            <Plus size={18} /> إضافة عميل
          </button>
          <button onClick={() => setIsBulkImportOpen(true)} className="sgui-button">
            <Upload size={18} /> استيراد
          </button>
          <details className="sgui-action-menu">
            <summary><MoreHorizontal size={18} /> إجراءات أخرى</summary>
            <div>
              <button type="button" onClick={exportBookings} disabled={isExporting} title="تصدير كل الحجوزات اللي في نطاقك لملف Excel">
                <Download size={17} /> {isExporting ? 'جاري التصدير...' : 'تصدير الحجوزات Excel'}
              </button>
              {canBulkTransfer && (
                <button type="button" onClick={() => setIsBulkTransferOpen(true)}>
                  <Layers size={17} /> تحويل جماعي
                </button>
              )}
              {isAdmin && (
                <button type="button" onClick={() => navigate('/ai-assistant')} title="فتح المساعد الذكي (مارو) وتحليل العملاء واقتراحات المتابعة">
                  <Sparkles size={17} /> اقتراحات مارو (AI)
                </button>
              )}
            </div>
          </details>
        </>}
      />

      {/* Filters: daily ones always visible, the rest under "فلاتر متقدمة". */}
      <FilterPanel
        advancedCount={advancedFiltersCount}
        activeCount={advancedFiltersCount + [filterStatus, filterService, filterSalesAgent].filter(v => v !== 'all').length + (searchTerm ? 1 : 0) + (sortBy !== 'createdAt' ? 1 : 0)}
        onReset={resetFilters}
        main={<>
          <Field label="بحث" wide>
            <div className="sgui-field-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" placeholder="اسم العميل أو آخر أرقام التليفون..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
          </Field>
          <Field label="الحالة">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} disabled={isSearchActive}>
              <option value="all">كل الحالات</option>
              {Object.entries(StatusLabels).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
            </select>
          </Field>
          <Field label="الخدمة المطلوبة">
            <select value={filterService} onChange={e => setFilterService(e.target.value)} disabled={isSearchActive}>
              <option value="all">كل الخدمات</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          {isHighRole && (
            <Field label="السيلز">
              <select value={filterSalesAgent} onChange={e => setFilterSalesAgent(e.target.value)}>
                <option value="all">كل السيلز</option>
                {salesAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="الترتيب">
            <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} disabled={isSearchActive}>
              <option value="createdAt">الأحدث تسجيلاً</option>
              <option value="lastChatwootContactAsc">الأقدم تواصل في Chatwoot</option>
            </select>
          </Field>
        </>}
        advanced={<>
          <Field label="التصنيف (Label)">
            <select value={filterLabel} onChange={e => setFilterLabel(e.target.value)} disabled={isSearchActive}>
              <option value="all">كل التصنيفات</option>
              {allLabels.map(l => <option key={l.id} value={l.id}>{l.text}</option>)}
            </select>
          </Field>
          <Field label="الكورس المحجوز">
            <select value={filterBookedCourse} onChange={e => setFilterBookedCourse(e.target.value)} disabled={isSearchActive}>
              <option value="all">أي كورس</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="اللابتوب">
            <select value={filterLaptop} onChange={e => setFilterLaptop(e.target.value)} disabled={isSearchActive}>
              <option value="all">الكل</option>
              <option value={LaptopStatus.WITH}>معاه لابتوب</option>
              <option value={LaptopStatus.WITHOUT}>من غير لابتوب</option>
              <option value={LaptopStatus.UNSPECIFIED}>لم يحدد</option>
            </select>
          </Field>
          <Field label="نظام الحضور">
            <select value={filterMode} onChange={e => setFilterMode(e.target.value)} disabled={isSearchActive}>
              <option value="all">الكل</option>
              <option value={AttendanceMode.ONLINE}>أونلاين</option>
              <option value={AttendanceMode.OFFLINE}>أوفلاين</option>
              <option value={AttendanceMode.UNSPECIFIED}>لم يحدد</option>
            </select>
          </Field>
          <Field label="الجنس">
            <select value={filterGender} onChange={e => setFilterGender(e.target.value)} disabled={isSearchActive}>
              <option value="all">الكل</option>
              <option value={Gender.MALE}>ذكر</option>
              <option value={Gender.FEMALE}>أنثى</option>
              <option value={Gender.UNSPECIFIED}>لم يحدد</option>
            </select>
          </Field>
          <Field label="طريقة الدفع">
            <select value={filterTransferType} onChange={e => setFilterTransferType(e.target.value)} disabled={isSearchActive}>
              <option value="all">الكل</option>
              <option value="external">تحويل خارجي (خارج مصر)</option>
              <option value="local">دفع محلي (داخل مصر)</option>
            </select>
          </Field>
        </>}
      />
      {isSearchActive && <p className="sgui-hint">البحث بيدوّر في كل العملاء المتاحين ليك، والفلاتر بتتوقف لحد ما تمسح البحث.</p>}

      {canDelete && selectedClientIds.length > 0 && (
        <div className="sgui-selection-bar" role="region" aria-label="العملاء المحددين">
          <strong>تم تحديد {selectedClientIds.length} عميل</strong>
          <div>
            <button type="button" onClick={toggleVisibleSelection} disabled={filteredClients.length === 0} className="sgui-button">
              {allVisibleSelected ? 'إلغاء تحديد الظاهر' : 'تحديد كل الظاهر'}
            </button>
            <button type="button" onClick={() => setSelectedClientIds([])} className="sgui-button">إلغاء التحديد</button>
            <button type="button" onClick={handleBulkDelete} disabled={isBulkDeleting} className="sgui-button is-danger">
              <Trash2 size={16} />
              {isBulkDeleting ? 'جاري الحذف...' : `حذف ${selectedClientIds.length} عميل`}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="sgui-table-wrap">
        <div className="overflow-x-auto">
          <table className="sgui-card-table w-full text-right">
            <thead>
              <tr>
                {canDelete && (
                  <th className="w-14 px-6 py-5 text-center">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleVisibleSelection}
                      className="w-5 h-5 accent-rose-600"
                      title="تحديد كل العملاء الظاهرين"
                    />
                  </th>
                )}
                <th>العميل / وقت التسجيل</th>
                <th>الحالة / الخدمة</th>
                <th>المواصفات</th>
                <th className="text-center">المسؤول</th>
                <th className="text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredClients.length === 0 ? (
                <tr><td colSpan={canDelete ? 6 : 5} className="py-20 text-center text-slate-400 font-bold italic">لا يوجد عملاء حالياً</td></tr>
              ) : filteredClients.map((client) => {
                const isUnreviewedAi = client.createdVia === 'ai_automation' && !client.reviewedBySales;
                const isUnreviewedFollowUp = !isUnreviewedAi && client.nextFollowUpSetVia === 'ai_automation' && !client.nextFollowUpReviewedBySales && !!client.nextFollowUpDate;
                const sourceMeta = getClientSourceMeta(client.source);
                const SourceIcon = sourceMeta.Icon;
                const clientLabels = (client.labels || [])
                  .map(labelId => allLabels.find(label => label.id === labelId))
                  .filter(Boolean) as Label[];

                return (
                <tr key={client.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all ${selectedClientSet.has(client.id) ? 'bg-rose-50/60 dark:bg-rose-500/5' : (isUnreviewedAi || isUnreviewedFollowUp) ? 'bg-orange-50/60 dark:bg-orange-500/10 border-r-2 border-orange-400' : ''}`}>
                  {canDelete && (
                    <td className="sgui-cell-select text-center">
                      <input
                        type="checkbox"
                        checked={selectedClientSet.has(client.id)}
                        onChange={() => toggleClientSelection(client.id)}
                        className="w-5 h-5 accent-rose-600"
                        title={`تحديد ${client.name}`}
                      />
                    </td>
                  )}
                  <td className="sgui-cell-wide">
                    <div className="flex items-center gap-3">
                      <div
                        className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${sourceMeta.box}`}
                        title={`مصدر العميل: ${sourceMeta.label}`}
                        aria-label={`مصدر العميل: ${sourceMeta.label}`}
                      >
                        <SourceIcon size={18}/>
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p onClick={() => navigate(`/clients/${client.id}`)} className={`font-black text-sm cursor-pointer hover:text-primary-500 ${(isUnreviewedAi || isUnreviewedFollowUp) ? 'text-orange-600 dark:text-orange-400' : 'text-slate-900 dark:text-white'}`}>{client.name}</p>
                          <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black border border-current/10 ${sourceMeta.box}`}>
                            {sourceMeta.label}
                          </span>
                          {isUnreviewedAi ? (
                            <button
                              onClick={() => setAcceptFlowClient(client)}
                              title="عميل AI Generated — اضغط للمراجعة والقبول"
                              className="cursor-pointer bg-orange-100 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 text-[8px] font-black px-2 py-1 rounded-lg border border-orange-200 dark:border-orange-500/20 flex items-center gap-1 hover:bg-orange-200 dark:hover:bg-orange-500/20 transition-all"
                            >
                              <Sparkles size={9} /> AI Generated — Accept
                            </button>
                          ) : isUnreviewedFollowUp ? (
                            <button
                              onClick={() => setAcceptFlowClient(client)}
                              title="فيه موعد متابعة مقترح من الأتمتة — اضغط للمراجعة"
                              className="cursor-pointer bg-orange-100 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 text-[8px] font-black px-2 py-1 rounded-lg border border-orange-200 dark:border-orange-500/20 flex items-center gap-1 hover:bg-orange-200 dark:hover:bg-orange-500/20 transition-all"
                            >
                              <Sparkles size={9} /> متابعة مقترحة — Accept
                            </button>
                          ) : client.createdVia === 'ai_automation' && client.reviewedByName && (
                            <span
                              title={client.reviewedAt ? new Date(client.reviewedAt).toLocaleString('ar-EG') : ''}
                              className="bg-slate-100 dark:bg-slate-800 text-slate-400 text-[8px] font-black px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 flex items-center gap-1"
                            >
                              <Sparkles size={9} /> AI Generated & Accepted by {client.reviewedByName}
                            </span>
                          )}
                          {!isHighRole && poolAgentId && client.salesAgentId === poolAgentId && (
                            <span
                              title="العميل ده لسه على الحساب المشترك، ظاهر لكل السيلز لحد ما حد يعمله Assign to me"
                              className="bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 text-[8px] font-black px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-500/20"
                            >
                              غير معيّن — من الحساب المشترك
                            </span>
                          )}
                          {client.isExternalTransfer && (
                            <span className="bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[8px] font-black px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-500/10">
                              تحويل خارجي ({client.originalCurrency})
                            </span>
                          )}
                          {isAdmin && client.aiRecommendation && (
                            <span 
                              onClick={() => navigate(`/clients/${client.id}`)}
                              className="cursor-pointer bg-gradient-to-r from-purple-500/10 to-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[8px] font-black px-1.5 py-0.5 rounded-md flex items-center gap-1 hover:opacity-80"
                              title={`اقتراح مارو: ${client.aiRecommendation.suggestedChannel} - أولوية ${client.aiRecommendation.conversionPriority}`}
                            >
                              <Sparkles size={10} className="text-amber-500" />
                              <span>مارو: {client.aiRecommendation.conversionPriority}</span>
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 mt-0.5" dir="ltr">{client.phone}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-[9px] font-black text-slate-400 flex items-center gap-1">
                            <Clock size={10}/> {new Date(client.createdAt).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </p>
                          {client.lastChatwootContactAt && (
                            <p className="text-[9px] font-black text-teal-500 dark:text-teal-400 flex items-center gap-1" title="آخر تواصل فعلي في Chatwoot">
                              <MessageCircle size={10}/> {new Date(client.lastChatwootContactAt).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                          {client.profileLink && (
                            <a href={client.profileLink} target="_blank" className="text-blue-500 hover:underline flex items-center gap-0.5 text-[8px] font-black">
                              <ExternalLink size={8}/> الرابط
                            </a>
                          )}
                          {client.chatId && (
                            <a href={buildChatwootConversationLink(client.chatId)} target="_blank" title="فتح المحادثة في Chatwoot" className="text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-0.5 text-[8px] font-black">
                              <MessageCircle size={8}/> الشات
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`sgui-state ${StatusLabels[client.status]?.color || ''}`}>
                      {StatusLabels[client.status]?.ar}
                    </span>
                    <p className="text-[10px] font-bold text-slate-500 mt-1">{client.serviceName}</p>
                    {clientLabels.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {clientLabels.slice(0, 3).map(label => (
                          <span
                            key={label.id}
                            className="max-w-[120px] truncate whitespace-nowrap px-2 py-0.5 rounded-lg text-[8px] font-black border"
                            style={getLabelColorStyle(label.color)}
                            title={label.text}
                          >
                            {label.text}
                          </span>
                        ))}
                        {clientLabels.length > 3 && (
                          <span className="px-2 py-0.5 rounded-lg text-[8px] font-black bg-slate-100 dark:bg-slate-800 text-slate-500">
                            +{clientLabels.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded text-[8px] font-black">{client.gender === Gender.MALE ? 'ذكر' : client.gender === Gender.FEMALE ? 'أنثى' : 'لم يحدد'}</span>
                      <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded text-[8px] font-black">{client.laptop === LaptopStatus.WITH ? 'لابتوب' : client.laptop === LaptopStatus.WITHOUT ? 'بدون لابتوب' : 'لم يحدد'}</span>
                      <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded text-[8px] font-black">{client.mode === AttendanceMode.ONLINE ? 'أونلاين' : client.mode === AttendanceMode.OFFLINE ? 'أوفلاين' : 'لم يحدد'}</span>
                    </div>
                  </td>
                  <td className="text-center">
                    {!isHighRole && poolAgentId && client.salesAgentId === poolAgentId ? (
                      <button
                        onClick={() => handleAssignToMe(client)}
                        title="تحويل العميل ده لك أنت"
                        className="bg-primary-500 hover:bg-primary-600 text-white text-[9px] font-black px-3 py-1.5 rounded-lg flex items-center gap-1 mx-auto transition-all"
                      >
                        <UserPlus size={11} /> Assign to me
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">{client.salesAgentName}</span>
                    )}
                  </td>
                  <td className="sgui-cell-wide sgui-cell-actions">
                    <div className="flex justify-center gap-2">
                      <a href={`https://wa.me/${client.phone.replace('+', '')}`} target="_blank" title="تواصل عبر واتساب" className="sgui-icon-button is-whatsapp" aria-label="واتساب"><MessageCircle size={16} /></a>
                      <a href={`tel:${client.phone}`} title="اتصال هاتفي" className="sgui-icon-button" aria-label="اتصال"><Phone size={16} /></a>
                      <button onClick={() => navigate(`/clients/${client.id}`)} title="عرض السجل والمتابعة" className="sgui-icon-button" aria-label="السجل والمتابعة"><History size={16} /></button>
                      {isAdmin && (
                        <button 
                          onClick={() => navigate(`/clients/${client.id}`)} 
                          title={client.aiRecommendation ? "عرض اقتراحات مارو (AI)" : "استخراج اقتراحات مارو (AI)"} 
                          className={`sgui-icon-button ${client.aiRecommendation ? 'is-marked' : ''}`}
                          aria-label="اقتراحات مارو"
                        >
                          <Sparkles size={16} />
                        </button>
                      )}
                      {isHighRole && (
                        <button onClick={() => { setSelectedClient(client); setIsTransferModalOpen(true); }} title="تحويل العميل لموظف آخر" className="sgui-icon-button" aria-label="تحويل العميل"><ArrowRightLeft size={16} /></button>
                      )}
                      {canDelete && (
                        <button onClick={async () => { 
                          const confirmation = prompt("لحذف العميل نهائياً، يرجى كتابة كلمة 'delete' للتأكيد:");
                          if(confirmation === 'delete') {
                            try {
                              await firestore.deleteDoc(firestore.doc(db, 'clients', client.id));
                              await logActivity(user!.uid, user!.name, `حذف العميل نهائياً: ${client.name}`, client.id, client.name);
                              // Remove from local state and cache
                              paged.patchRow(client.id, null);
                              setSelectedClientIds(prev => prev.filter(id => id !== client.id));
                              alert("تم حذف العميل بنجاح");
                            } catch (error) {
                              console.error("Error deleting client:", error);
                              alert("حدث خطأ أثناء الحذف. يرجى التحقق من الصلاحيات.");
                            }
                          } else if (confirmation !== null) {
                            alert("كلمة التأكيد غير صحيحة، لم يتم الحذف.");
                          }
                        }} title="حذف العميل" aria-label="حذف العميل" className="sgui-icon-button is-danger"><Trash2 size={16} /></button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        <Pager page={paged.page} pageCount={paged.pageCount} reachablePage={paged.reachablePage} total={paged.total} pageSize={paged.pageSize} loading={paged.loading} onPage={paged.goToPage} noun="عميل" />
      </div>

      {/* Add Client Panel */}
      <FloatingPanel 
        isOpen={isAddModalOpen} 
        onClose={() => setIsAddModalOpen(false)} 
        title="إضافة عميل جديد"
        icon={<Plus size={24} />}
      >
        <form onSubmit={handleAddClient} className="space-y-6">
          {isHighRole && (
            <div className="sg-form-section space-y-1.5 border-primary-500/20 bg-primary-500/5 dark:bg-primary-500/10">
              <label className="text-[10px] font-black text-primary-600 dark:text-primary-400 uppercase mr-2 flex items-center gap-1">
                <User size={14} />
                <span>السيلز / الموظف المسؤول عن العميل (اختياري)</span>
              </label>
              <select 
                className="w-full p-4 bg-white dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white border border-slate-200 dark:border-slate-700 text-xs" 
                value={newClient.assignedSalesAgentId} 
                onChange={e => setNewClient({...newClient, assignedSalesAgentId: e.target.value})}
              >
                <option value="">أنا المسؤول (تسجيل باسمي: {user?.name || 'الحالي'})</option>
                <option value={UNASSIGNED_AGENT}>لم يتم تحديد المسؤول بعد</option>
                {salesAgents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} {agent.id === user?.uid ? '(أنا)' : ''}
                  </option>
                ))}
              </select>
              <p className="text-[10px] font-bold text-slate-400 mr-2">
                تنويه: بصفتك مشرف/مسؤول، يمكنك تخصيص العميل لموظف مبيعات معين عند الإضافة مباشرة.
              </p>
            </div>
          )}
          {canEditChatId && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">Chat ID (اختياري)</label>
              <input className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold dark:text-white" dir="ltr" placeholder="Chat ID" value={newClient.chatId} onChange={e => setNewClient({...newClient, chatId: e.target.value})} />
            </div>
          )}
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
              <input className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold dark:text-white mt-2" placeholder="الصفة / الوظيفة (اختياري)" value={newClient.position} onChange={e => setNewClient({...newClient, position: e.target.value})} />
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
                <option value={Gender.UNSPECIFIED}>لم يحدد</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">حالة اللابتوب</label>
              <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={newClient.laptop} onChange={e => setNewClient({...newClient, laptop: e.target.value as LaptopStatus})}>
                <option value={LaptopStatus.WITH}>مع لابتوب</option>
                <option value={LaptopStatus.WITHOUT}>بدون لابتوب</option>
                <option value={LaptopStatus.UNSPECIFIED}>لم يحدد</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">نظام الحضور</label>
              <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none dark:text-white" value={newClient.mode} onChange={e => setNewClient({...newClient, mode: e.target.value as AttendanceMode})}>
                <option value={AttendanceMode.OFFLINE}>أوفلاين (في المقر)</option>
                <option value={AttendanceMode.ONLINE}>أونلاين (عن بعد)</option>
                <option value={AttendanceMode.UNSPECIFIED}>لم يحدد</option>
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
              <label className="text-[10px] font-black text-slate-400 uppercase mr-2">رقم الهاتف ({newClient.source === ClientSource.WHATSAPP ? 'إجباري' : 'اختياري'})</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400" dir="ltr">{newClient.countryCode}</span>
                <input 
                  required={newClient.source === ClientSource.WHATSAPP} 
                  className="w-full p-4 pl-16 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold text-right dark:text-white" 
                  dir="ltr" 
                  placeholder="01012345678" 
                  value={newClient.phone} 
                  onChange={e => handlePhoneChange(e.target.value)} 
                />
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
                    style={getLabelColorStyle(label.color, isSelected)}
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

          <div className="sg-form-section space-y-4 border-blue-100 bg-blue-50 dark:bg-blue-500/5 dark:border-blue-500/20">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase text-blue-600 dark:text-blue-400">آخر متابعة مع العميل</h3>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400">تسجيل آخر متابعة</span>
                <input
                  type="checkbox"
                  checked={newClient.hasLastFollowUp}
                  onChange={e => setNewClient({...newClient, hasLastFollowUp: e.target.checked})}
                  className="w-5 h-5 accent-blue-500"
                />
              </div>
            </div>

            {newClient.hasLastFollowUp && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">تاريخ آخر متابعة</label>
                  <input
                    type="date"
                    required
                    className="w-full p-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none"
                    value={newClient.lastFollowUpDate}
                    onChange={e => setNewClient({...newClient, lastFollowUpDate: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">توقيت آخر متابعة</label>
                  <div className="flex gap-2">
                    <input
                      type="time"
                      required
                      className="flex-1 p-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none"
                      value={newClient.lastFollowUpTime}
                      onChange={e => setNewClient({...newClient, lastFollowUpTime: e.target.value})}
                    />
                    <select
                      className="p-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none"
                      value={newClient.lastFollowUpPeriod}
                      onChange={e => setNewClient({...newClient, lastFollowUpPeriod: e.target.value as any})}
                    >
                      <option value="AM">AM</option>
                      <option value="PM">PM</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="sg-form-section space-y-4">
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

          <div className="sg-form-section space-y-4 border-amber-200 bg-amber-50 dark:bg-amber-500/5 dark:border-amber-500/20">
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

                <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-500">تم الحجز من خارج مصر؟</span>
                  <input 
                    type="checkbox" 
                    checked={newClient.isExternalTransfer} 
                    onChange={e => {
                      updateExternalBooking(
                        e.target.checked, 
                        newClient.originalCurrency, 
                        newClient.originalTotalPrice, 
                        newClient.originalPaidAmount
                      );
                    }} 
                    className="w-4 h-4 accent-amber-500" 
                  />
                </div>

                {newClient.isExternalTransfer ? (
                  <div className="space-y-4 p-4 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-amber-350">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase mr-2">العُملة</label>
                        <select 
                          className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-xs outline-none" 
                          value={newClient.originalCurrency} 
                          onChange={e => {
                            updateExternalBooking(
                              true, 
                              e.target.value, 
                              newClient.originalTotalPrice, 
                              newClient.originalPaidAmount
                            );
                          }}
                        >
                          {Object.entries(CURRENCY_LABELS).map(([code, label]) => (
                            code !== 'EGP' && <option key={code} value={code}>{label.ar} ({code})</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase mr-2">سعر الصرف (مقابل الجنيه)</label>
                        <input 
                          type="number" 
                          step="0.0001"
                          className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-xs outline-none" 
                          value={newClient.exchangeRateUsed} 
                          onChange={e => {
                            const rate = parseFloat(e.target.value) || 1;
                            updateExternalBooking(
                              true, 
                              newClient.originalCurrency, 
                              newClient.originalTotalPrice, 
                              newClient.originalPaidAmount, 
                              rate
                            );
                          }} 
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase mr-2">الإجمالي ({newClient.originalCurrency})</label>
                        <input 
                          type="number" 
                          required 
                          className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-xs outline-none" 
                          value={newClient.originalTotalPrice || ''} 
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0;
                            updateExternalBooking(
                              true, 
                              newClient.originalCurrency, 
                              val, 
                              newClient.originalPaidAmount
                            );
                          }} 
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase mr-2">المدفوع ({newClient.originalCurrency})</label>
                        <input 
                          type="number" 
                          required 
                          className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-xs outline-none" 
                          value={newClient.originalPaidAmount || ''} 
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0;
                            updateExternalBooking(
                              true, 
                              newClient.originalCurrency, 
                              newClient.originalTotalPrice, 
                              val
                            );
                          }} 
                        />
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl space-y-2 text-[10px] text-right">
                      <div className="flex justify-between text-slate-500 font-bold">
                        <span>المبلغ المحول للمصري:</span>
                        <span>{parseFloat(((newClient.originalTotalPrice || 0) * newClient.exchangeRateUsed).toFixed(2))} ج.م إجمالي | {parseFloat(((newClient.originalPaidAmount || 0) * newClient.exchangeRateUsed).toFixed(2))} ج.م مدفوع</span>
                      </div>
                      <div className="flex justify-between text-rose-500 font-bold border-t border-slate-100 dark:border-slate-800 pt-1.5">
                        <span>خصم 17% (3% عمولة و 14% ضريبة):</span>
                        <span>- {parseFloat((((newClient.originalTotalPrice || 0) * newClient.exchangeRateUsed) * 0.17).toFixed(2))} ج.م | - {parseFloat((((newClient.originalPaidAmount || 0) * newClient.exchangeRateUsed) * 0.17).toFixed(2))} ج.م</span>
                      </div>
                      <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-black border-t border-slate-100 dark:border-slate-800 pt-1.5 text-xs">
                        <span>المبلغ النهائي بالمصري:</span>
                        <span>{newClient.totalPrice} ج.م إجمالي | {newClient.paidAmount} ج.م مدفوع</span>
                      </div>
                      <p className="text-[9px] text-slate-400 font-semibold italic text-center mt-1">سبب الخصم: ٣٪ عمولة تحويل و ١٤٪ ضرايب</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase mr-2">السعر الإجمالي (ج.م)</label>
                      <input 
                        type="number" 
                        required 
                        className="w-full p-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none" 
                        value={newClient.totalPrice || ''} 
                        onChange={e => updateRemaining(parseFloat(e.target.value) || 0, newClient.paidAmount)} 
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase mr-2">المبلغ المدفوع (ج.م)</label>
                      <input 
                        type="number" 
                        required 
                        className="w-full p-4 bg-white dark:bg-slate-900 rounded-2xl font-bold text-xs outline-none" 
                        value={newClient.paidAmount || ''} 
                        onChange={e => updateRemaining(newClient.totalPrice, parseFloat(e.target.value) || 0)} 
                      />
                    </div>
                  </div>
                )}

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
            className={`sg-btn w-full py-5 ${isSubmitting ? 'bg-slate-400 cursor-not-allowed text-white' : 'sg-btn-primary'}`}
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

      {/* Bulk Import Modal */}
      {isBulkImportOpen && (
        <React.Suspense fallback={null}>
          <BulkImportModal 
            isOpen={isBulkImportOpen}
            onClose={() => setIsBulkImportOpen(false)}
            currentUser={{ uid: user?.uid || '', name: user?.name || '' }}
            salesAgents={salesAgents}
            services={services}
            onSuccess={() => {
              setIsBulkImportOpen(false);
              paged.reload();
            }}
          />
        </React.Suspense>
      )}

      {acceptFlowClient && (
        <AcceptFlowModal
          key={acceptFlowClient.id}
          client={acceptFlowClient}
          onClose={() => setAcceptFlowClient(null)}
          onDone={(updated) => {
            paged.patchRow(updated.id, updated);
            setAcceptFlowClient(null);
          }}
        />
      )}
    </div>
  );
};

export default ClientsList;
