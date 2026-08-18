import React, { useState, useEffect } from 'react';
import * as firestore from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { Client, UserRole, User, ClientStatus, CommMethod, AiRecommendation, FollowUp } from '../types';
import { analyzeClientWithAi } from '../geminiService';
import { 
  Bot, Sparkles, Calendar, Phone, CheckCircle2, AlertTriangle, 
  RefreshCw, Filter, Copy, Check, XCircle, ArrowRight, UserCheck, 
  MessageSquare, TrendingUp, Shield, Zap, BookOpen, Clock, Gift, Award, HelpCircle, ChevronDown, ChevronUp, X, Layers, Tag, RotateCcw,
  Eye, CheckSquare, Square, Edit3, MessageCircle, CheckCheck, ArrowUpDown, SlidersHorizontal, ShieldAlert, FileText, CornerDownLeft
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface BatchBackup {
  timestamp: number;
  round: number;
  count: number;
  clientBackups: Array<{
    clientId: string;
    clientName: string;
    previousAiRecommendation?: AiRecommendation | null;
  }>;
}

export const AiAssistant: React.FC = () => {
  const { user, effectiveRole } = useAuth();
  const navigate = useNavigate();

  const [clients, setClients] = useState<Client[]>([]);
  const [salesAgents, setSalesAgents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Main View Tabs: Sales Queue vs Supervisor Audit
  const [activeTab, setActiveTab] = useState<'sales_queue' | 'supervisor_audit'>('sales_queue');

  // Sorting Option (Newest AI Analysis First by default)
  const [sortOption, setSortOption] = useState<'newest_ai' | 'priority' | 'round' | 'newest_client'>('newest_ai');

  // Filters
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('pending'); // 'pending' | 'accepted' | 'skipped' | 'outdated' | 'all'
  const [searchQuery, setSearchQuery] = useState('');

  // Supervisor Audit Filter
  const [supervisorAuditFilter, setSupervisorAuditFilter] = useState<'all' | 'pending_check' | 'accepted' | 'skipped'>('all');

  // Sales Action Modal State
  const [actionModalClient, setActionModalClient] = useState<Client | null>(null);
  const [actionModalType, setActionModalType] = useState<'ACCEPT' | 'SKIP' | null>(null);
  const [salesCommentInput, setSalesCommentInput] = useState<string>('');

  // Supervisor Override Modal State
  const [supervisorModalClient, setSupervisorModalClient] = useState<Client | null>(null);
  const [supervisorNoteInput, setSupervisorNoteInput] = useState<string>('');

  // Batch Processing Options
  const [batchSizeLimit, setBatchSizeLimit] = useState<number>(25);
  const [onlyInterested, setOnlyInterested] = useState<boolean>(true);
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);

  // Round Management State
  const [currentRound, setCurrentRound] = useState<number>(() => {
    const saved = localStorage.getItem('saber_ai_current_round');
    return saved ? Math.max(1, parseInt(saved, 10) || 1) : 1;
  });

  // Save currentRound to localStorage
  useEffect(() => {
    localStorage.setItem('saber_ai_current_round', currentRound.toString());
  }, [currentRound]);

  // Sync max round if any loaded client has a higher round number
  useEffect(() => {
    if (clients.length > 0) {
      let maxR = currentRound;
      clients.forEach(c => {
        if (c.aiRecommendation?.round && c.aiRecommendation.round > maxR) {
          maxR = c.aiRecommendation.round;
        }
      });
      if (maxR > currentRound) {
        setCurrentRound(maxR);
      }
    }
  }, [clients]);

  // Single Analysis Loading State
  const [analyzingClientId, setAnalyzingClientId] = useState<string | null>(null);

  // Last Batch Backup State for Reverting Analysis
  const [lastBatchBackup, setLastBatchBackup] = useState<BatchBackup | null>(() => {
    try {
      const saved = localStorage.getItem('saber_ai_last_batch_backup');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isRevertingBatch, setIsRevertingBatch] = useState(false);

  // Active Sales Agents Selection & Per-Agent Quota
  const [selectedActiveAgentIds, setSelectedActiveAgentIds] = useState<string[]>([]);
  const [perAgentQuota, setPerAgentQuota] = useState<number>(25);
  const [showBatchConfigModal, setShowBatchConfigModal] = useState<boolean>(false);

  // Auto-initialize selected active sales agents when agents list loads
  useEffect(() => {
    if (salesAgents.length > 0 && selectedActiveAgentIds.length === 0) {
      setSelectedActiveAgentIds(salesAgents.map(a => a.uid));
    }
  }, [salesAgents]);

  // Knowledge Base Modal / Drawer State
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);

  // Copy feedback state
  const [copiedClientId, setCopiedClientId] = useState<string | null>(null);

  const isHighRole = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.SUPERVISOR || effectiveRole === UserRole.MANAGER || effectiveRole === UserRole.TEAM_LEADER;
  const isSupervisorOrAbove = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.SUPERVISOR || effectiveRole === UserRole.MANAGER || effectiveRole === UserRole.TEAM_LEADER;
  const isAdmin = effectiveRole === UserRole.ADMIN;

  const todayDateStr = new Date().toISOString().split('T')[0];

  // Helper to check if recommendation is generated today
  const isGeneratedToday = (genTimestamp?: number) => {
    if (!genTimestamp) return false;
    const genDateStr = new Date(genTimestamp).toISOString().split('T')[0];
    return genDateStr === todayDateStr;
  };

  // Helper to check if client is a active target for sales follow-up (Interested/Potential & NOT yet booked)
  const isClientInterested = (c: Client) => {
    const statusStr = (c.status || '').toLowerCase().trim();
    if (
      statusStr === 'not_interested' || 
      statusStr === 'غير مهتم' || 
      statusStr === 'غير مهتم اطلاقاً' || 
      statusStr === 'ملغي' ||
      statusStr === 'مستبعد' ||
      statusStr === 'booked' ||
      statusStr === 'حجز' ||
      statusStr === 'حجز بالفعل' ||
      statusStr === 'مسجل' ||
      statusStr === 'تم الحجز' ||
      statusStr === 'enrolled'
    ) {
      return false; // Exclude non-interested and ALREADY BOOKED students from active sales AI queue
    }
    return true;
  };

  // Fetch Clients and Sales Agents
  useEffect(() => {
    if (!user) return;

    const fetchAgents = async () => {
      try {
        const usersSnap = await firestore.getDocs(firestore.collection(db, 'users'));
        const agentsList = usersSnap.docs
          .map(doc => ({ uid: doc.id, ...doc.data() } as User))
          .filter(u => !u.isDeactivated);
        setSalesAgents(agentsList);
      } catch (err) {
        console.error("Error fetching sales agents:", err);
      }
    };
    fetchAgents();

    const clientsRef = firestore.collection(db, 'clients');
    let q;

    if (isHighRole && selectedAgentId === 'all') {
      q = firestore.query(clientsRef);
    } else if (isHighRole && selectedAgentId !== 'all') {
      q = firestore.query(clientsRef, firestore.where('salesAgentId', '==', selectedAgentId));
    } else {
      q = firestore.query(clientsRef, firestore.where('salesAgentId', '==', user.uid));
    }

    const unsubscribe = firestore.onSnapshot(q, (snapshot) => {
      const allClients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
      setClients(allClients);
      setLoading(false);
    }, (err) => {
      console.error("Error subscribing to clients:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, effectiveRole, selectedAgentId, isHighRole]);

  // Handle single client analysis with target round tagging
  const handleAnalyzeClient = async (client: Client, targetRound?: number, skipAdminCheck = true) => {
    const activeRound = targetRound ?? currentRound;
    setAnalyzingClientId(client.id);
    try {
      const followUpsSnap = await firestore.getDocs(
        firestore.query(
          firestore.collection(db, 'followups'),
          firestore.where('clientId', '==', client.id)
        )
      );
      const followUps = followUpsSnap.docs.map(d => d.data() as FollowUp);

      const result = await analyzeClientWithAi(client, followUps);

      const [year, month, day] = (result.suggestedDate || '').split('-').map(Number);
      let suggestedTimestamp = Date.now() + 86400000;
      if (year && month && day) {
        const [hours, minutes] = (result.suggestedTime || '12:00').split(':').map(Number);
        suggestedTimestamp = new Date(year, month - 1, day, hours || 12, minutes || 0).getTime();
      }

      const newRecommendation: AiRecommendation = {
        suggestedDate: result.suggestedDate || new Date(suggestedTimestamp).toISOString().split('T')[0],
        suggestedTime: result.suggestedTime || '12:00',
        suggestedTimestamp,
        suggestedChannel: result.suggestedChannel || 'واتساب',
        suggestedPitch: result.suggestedPitch || 'مرحباً، أود متابعة استفسارك بخصوص الدورة التدريبية مع أكاديمية صابر جروب...',
        conversionPriority: (result.conversionPriority as any) || 'متوسط',
        insightsSummary: result.insightsSummary || 'تحليل ذكي بناءً على حالة العميل وسجلات المتابعة وقاعدة معرفة الأكاديمية.',
        salesTip: result.salesTip || 'استخدم الخصم المبكر أو كوبون الـ 400 جنيه الخاص بتجربة المساعد الذكي تشجيعاً له.',
        generatedAt: Date.now(),
        status: 'PENDING',
        round: activeRound
      };

      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), {
        aiRecommendation: newRecommendation
      });

    } catch (err: any) {
      console.error("Error analyzing client:", err);
    } finally {
      setAnalyzingClientId(null);
    }
  };

  // Run Batch Analysis under the Round System with Per-Agent Quota
  const handleBatchAnalyze = async (options: { customLimit?: number; forceNextRound?: boolean } = {}) => {
    let activeRound = currentRound;

    if (options.forceNextRound) {
      if (!isAdmin) {
        alert("بدء راوند جديد متاح للإدمن (Admin) فقط.");
        return;
      }
      activeRound = currentRound + 1;
      setCurrentRound(activeRound);
    }

    // 1. Filter candidates based on interest preference (skips booked / non-interested)
    let eligibleClients = clients;
    if (onlyInterested) {
      eligibleClients = clients.filter(c => isClientInterested(c));
    }

    // 2. Filter candidates needing analysis in `activeRound`
    let candidateClients = eligibleClients.filter(c => {
      if (!c.aiRecommendation) return true;
      return (c.aiRecommendation.round || 0) < activeRound;
    });

    const targetClients: Client[] = [];

    // Helper sort function for candidate clients
    const sortCandidates = (list: Client[]) => {
      return [...list].sort((a, b) => {
        const aRound = a.aiRecommendation?.round || 0;
        const bRound = b.aiRecommendation?.round || 0;
        if (aRound !== bRound) return aRound - bRound;

        const aStatus = (a.status || '').toLowerCase();
        const bStatus = (b.status || '').toLowerCase();
        const aIsHot = aStatus.includes('interested') || aStatus.includes('مهتم');
        const bIsHot = bStatus.includes('interested') || bStatus.includes('مهتم');
        if (aIsHot && !bIsHot) return -1;
        if (!aIsHot && bIsHot) return 1;

        return (b.createdAt || 0) - (a.createdAt || 0);
      });
    };

    if (isAdmin) {
      if (selectedActiveAgentIds.length === 0) {
        alert("يرجى اختيار مسؤول مبيعات واحد على الأقل من السيلز الشغالين حالياً قبل بدء التحليل!");
        setShowBatchConfigModal(true);
        return;
      }

      // Check if candidates exist for selected active agents
      const candidatesForActiveAgents = candidateClients.filter(c => 
        c.salesAgentId && selectedActiveAgentIds.includes(c.salesAgentId)
      );

      if (candidatesForActiveAgents.length === 0 && candidateClients.length === 0) {
        const confirmNext = window.confirm(
          `🎉 مكتمل! تم تحليل جميع العملاء المؤهلين للـ (${selectedActiveAgentIds.length}) سيلز المحددين في الجولة الحاليّة (Round ${activeRound})!\n\nهل ترغب في البدء التلقائي في الجولة الجديدة (Round ${activeRound + 1}) وإعادة فحص العملاء مجدداً؟`
        );
        if (confirmNext) {
          activeRound = activeRound + 1;
          setCurrentRound(activeRound);
          candidateClients = eligibleClients.filter(c => !c.aiRecommendation || (c.aiRecommendation.round || 0) < activeRound);
        } else {
          return;
        }
      }

      // Per-Agent Allocation for Admin:
      selectedActiveAgentIds.forEach(agentUid => {
        const agentCandidates = candidateClients.filter(c => c.salesAgentId === agentUid);
        const sorted = sortCandidates(agentCandidates);
        const chosen = sorted.slice(0, perAgentQuota);
        targetClients.push(...chosen);
      });

      // Handle unassigned candidates if target batch is empty
      const unassignedCandidates = candidateClients.filter(c => !c.salesAgentId || !selectedActiveAgentIds.includes(c.salesAgentId));
      if (unassignedCandidates.length > 0 && targetClients.length === 0) {
        const sorted = sortCandidates(unassignedCandidates);
        targetClients.push(...sorted.slice(0, perAgentQuota));
      }
    } else {
      // For Sales Agent: Target their own candidate clients up to perAgentQuota
      const myCandidates = candidateClients.filter(c => !c.salesAgentId || c.salesAgentId === user?.uid);
      const sorted = sortCandidates(myCandidates.length > 0 ? myCandidates : candidateClients);
      const chosen = sorted.slice(0, perAgentQuota);
      targetClients.push(...chosen);
    }

    if (targetClients.length === 0) {
      alert("لا يوجد عملاء بحاجة للتحليل حالياً في هذه الجولة!");
      return;
    }

    // Save backup of target batch BEFORE running analysis
    const backups = targetClients.map(c => ({
      clientId: c.id,
      clientName: c.name,
      previousAiRecommendation: c.aiRecommendation ? JSON.parse(JSON.stringify(c.aiRecommendation)) : null
    }));

    const newBackup: BatchBackup = {
      timestamp: Date.now(),
      round: activeRound,
      count: targetClients.length,
      clientBackups: backups
    };

    setLastBatchBackup(newBackup);
    try {
      localStorage.setItem('saber_ai_last_batch_backup', JSON.stringify(newBackup));
    } catch (e) {
      console.warn("Could not save batch backup to localStorage", e);
    }

    setIsBatchAnalyzing(true);
    setBatchProgress(1);

    // 4. Concurrency execution in chunks of 4
    const CONCURRENCY = 4;
    let processedCount = 0;

    for (let i = 0; i < targetClients.length; i += CONCURRENCY) {
      const chunk = targetClients.slice(i, i + CONCURRENCY);
      
      await Promise.all(
        chunk.map(async (c) => {
          try {
            await handleAnalyzeClient(c, activeRound, true);
          } catch (e) {
            console.warn(`Failed to analyze client ${c.name}`, e);
          }
        })
      );

      processedCount += chunk.length;
      setBatchProgress(Math.round((processedCount / targetClients.length) * 100));

      if (i + CONCURRENCY < targetClients.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    setIsBatchAnalyzing(false);
  };

  // Revert / Undo Last Analyzed Batch
  const handleRevertLastBatch = async () => {
    if (!isAdmin) {
      alert("خاصية التراجع عن تحليل الدفعة مخصصة للإدمن (Admin) فقط!");
      return;
    }

    if (!lastBatchBackup || !lastBatchBackup.clientBackups || lastBatchBackup.clientBackups.length === 0) {
      alert("لا توجد دفعة سابقة محفوظة للتراجع عنها!");
      return;
    }

    const confirmMsg = `هل أنت متأكد من التراجع عن تحليل آخر دفعة شملت (${lastBatchBackup.count} عميل) - Round ${lastBatchBackup.round}؟\n\nسيتم حذف نتائج التحليل الجديدة واستعادة حالة الذكاء الاصطناعي لكل عميل كما كانت تماماً قبل هذه الدفعة.`;
    if (!window.confirm(confirmMsg)) return;

    setIsRevertingBatch(true);
    try {
      let count = 0;
      for (const item of lastBatchBackup.clientBackups) {
        const clientRef = firestore.doc(db, 'clients', item.clientId);
        if (item.previousAiRecommendation) {
          await firestore.updateDoc(clientRef, {
            aiRecommendation: item.previousAiRecommendation
          });
        } else {
          await firestore.updateDoc(clientRef, {
            aiRecommendation: firestore.deleteField()
          });
        }
        count++;
      }

      await logActivity(
        user?.uid || '',
        user?.name || 'الإدمن',
        `تراجع عن تحليل آخر دفعة بالذكاء الاصطناعي (${count} عميل)`,
        'batch',
        'جميع العملاء'
      );

      setLastBatchBackup(null);
      localStorage.removeItem('saber_ai_last_batch_backup');
      alert(`تم التراجع عن تحليل آخر دفعة (${count} عميل) بنجاح واستعادة حالتهم السابقة!`);
    } catch (err) {
      console.error("Error reverting last batch:", err);
      alert("حدث خطأ أثناء التراجع عن تحليل الدفعة.");
    } finally {
      setIsRevertingBatch(false);
    }
  };

  // Start Next Round manually
  const handleStartNextRoundManually = () => {
    if (!isAdmin) {
      alert("بدء راوند جديد متاح للإدمن (Admin) فقط حالياً.");
      return;
    }
    const nextR = currentRound + 1;
    if (window.confirm(`هل أنت تأكد من بدء الجولة الجديدة (Round ${nextR})؟\nسيؤدي ذلك لإعادة إتاحة جميع العملاء المؤهلين للتحليل والمتابعة تحت وسم Round ${nextR}.`)) {
      setCurrentRound(nextR);
      handleBatchAnalyze({ forceNextRound: true });
    }
  };

  // Execute Sales Action (Transfer to Follow-up OR Skip) with comment
  const handleExecuteSalesAction = async (client: Client, actionType: 'ACCEPT' | 'SKIP', comment: string) => {
    if (!client.aiRecommendation) return;

    try {
      const rec = client.aiRecommendation;
      const isAccept = actionType === 'ACCEPT';

      let method: CommMethod = CommMethod.WHATSAPP;
      if (rec.suggestedChannel?.includes('اتصال') || rec.suggestedChannel?.includes('هاتف')) {
        method = CommMethod.PHONE;
      } else if (rec.suggestedChannel?.includes('مقابلة') || rec.suggestedChannel?.includes('مقر')) {
        method = CommMethod.MEETING;
      }

      const now = Date.now();
      const updateData: any = {
        'aiRecommendation.status': isAccept ? 'ACCEPTED' : 'SKIPPED',
        'aiRecommendation.acceptedAt': now,
        'aiRecommendation.acceptedByUid': user?.uid || '',
        'aiRecommendation.acceptedByName': user?.name || 'موظف مبيعات',
        'aiRecommendation.salesComment': comment.trim() || (isAccept ? 'تم تحويله للمتابعة بناءً على توصية الذكاء الاصطناعي' : 'تم تخطي العميل (Skipped)'),
        'aiRecommendation.salesCheckAt': now,
      };

      if (isAccept) {
        updateData.nextFollowUpDate = rec.suggestedTimestamp || (now + 86400000);
        updateData.nextFollowUpMethod = method;
        const noteText = `[تحويل لمتابعة AI - ${user?.name}]: ${comment.trim() ? comment : rec.suggestedPitch}`;
        updateData.notes = client.notes ? `${client.notes}\n${noteText}` : noteText;
      }

      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), updateData);

      await logActivity(
        user?.uid || '',
        user?.name || 'موظف',
        isAccept ? `تحويل العميل ${client.name} للمتابعة مع رأي السيلز` : `تخطي توصية العميل ${client.name} (Skipped)`,
        client.id,
        client.name
      );

      setActionModalClient(null);
      setActionModalType(null);
      setSalesCommentInput('');

    } catch (err) {
      console.error("Error executing sales action:", err);
      alert("حدث خطأ أثناء حفظ الإجراء.");
    }
  };

  // Supervisor Check Acknowledge
  const handleSupervisorAcknowledge = async (client: Client) => {
    if (!client.aiRecommendation) return;
    try {
      const now = Date.now();
      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), {
        'aiRecommendation.supervisorCheck': true,
        'aiRecommendation.supervisorCheckedAt': now,
        'aiRecommendation.supervisorCheckedByName': user?.name || 'المشرف'
      });

      await logActivity(
        user?.uid || '',
        user?.name || 'المشرف',
        `تأكيد واعتماد المشرف لإجراء السيلز الخاص بالعميل ${client.name}`,
        client.id,
        client.name
      );
    } catch (err) {
      console.error("Error supervisor acknowledge:", err);
      alert("حدث خطأ أثناء اعتماد المشرف.");
    }
  };

  // Supervisor Override Re-assign to Follow-up
  const handleSupervisorReassignToFollowup = async (client: Client, note: string) => {
    if (!client.aiRecommendation) return;
    try {
      const rec = client.aiRecommendation;
      const now = Date.now();

      let method: CommMethod = CommMethod.WHATSAPP;
      if (rec.suggestedChannel?.includes('اتصال') || rec.suggestedChannel?.includes('هاتف')) {
        method = CommMethod.PHONE;
      }

      const noteText = `[إعادة للمتابعة بأمر المشرف - ${user?.name}]: ${note.trim() || 'إعادة للجدولة والمتابعة الفعالة'}`;

      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), {
        'aiRecommendation.status': 'ACCEPTED',
        'aiRecommendation.supervisorCheck': true,
        'aiRecommendation.supervisorCheckedAt': now,
        'aiRecommendation.supervisorCheckedByName': user?.name || 'المشرف',
        'aiRecommendation.supervisorNotes': note.trim() || 'تمت الإعادة للمتابعة بقرار المشرف',
        nextFollowUpDate: rec.suggestedTimestamp || (now + 86400000),
        nextFollowUpMethod: method,
        notes: client.notes ? `${client.notes}\n${noteText}` : noteText
      });

      await logActivity(
        user?.uid || '',
        user?.name || 'المشرف',
        `إعادة العميل ${client.name} للمتابعة بأمر المشرف`,
        client.id,
        client.name
      );

      setSupervisorModalClient(null);
      setSupervisorNoteInput('');

    } catch (err) {
      console.error("Error supervisor override:", err);
      alert("حدث خطأ أثناء تنفيذ أمر المشرف.");
    }
  };

  const copyPitchToClipboard = (clientId: string, pitch: string) => {
    navigator.clipboard.writeText(pitch);
    setCopiedClientId(clientId);
    setTimeout(() => setCopiedClientId(null), 2000);
  };

  // Filtering & Sorting for Sales Queue (Newest AI Analysis at top)
  const filteredClients = clients.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone.includes(searchQuery);
    if (!matchesSearch) return false;

    if (selectedAgentId !== 'all' && c.salesAgentId !== selectedAgentId) {
      return false;
    }

    if (statusFilter === 'pending') {
      if (!c.aiRecommendation || c.aiRecommendation.status !== 'PENDING') return false;
    } else if (statusFilter === 'accepted') {
      if (!c.aiRecommendation || c.aiRecommendation.status !== 'ACCEPTED') return false;
    } else if (statusFilter === 'skipped') {
      if (!c.aiRecommendation || c.aiRecommendation.status !== 'SKIPPED') return false;
    } else if (statusFilter === 'outdated') {
      if (!c.aiRecommendation || (c.aiRecommendation.round || 0) >= currentRound) return false;
    } else if (statusFilter === 'has_ai') {
      if (!c.aiRecommendation) return false;
    }

    if (priorityFilter !== 'all') {
      if (c.aiRecommendation?.conversionPriority !== priorityFilter) return false;
    }

    return true;
  }).sort((a, b) => {
    if (sortOption === 'newest_ai') {
      const aTime = a.aiRecommendation?.generatedAt || 0;
      const bTime = b.aiRecommendation?.generatedAt || 0;
      return bTime - aTime; // Newest AI analysis at top!
    } else if (sortOption === 'priority') {
      const priorityMap: Record<string, number> = { 'عالي': 3, 'متوسط': 2, 'منخفض': 1 };
      const aP = priorityMap[a.aiRecommendation?.conversionPriority || ''] || 0;
      const bP = priorityMap[b.aiRecommendation?.conversionPriority || ''] || 0;
      if (aP !== bP) return bP - aP;
      return (b.aiRecommendation?.generatedAt || 0) - (a.aiRecommendation?.generatedAt || 0);
    } else if (sortOption === 'round') {
      const aR = a.aiRecommendation?.round || 0;
      const bR = b.aiRecommendation?.round || 0;
      if (aR !== bR) return bR - aR;
      return (b.aiRecommendation?.generatedAt || 0) - (a.aiRecommendation?.generatedAt || 0);
    } else {
      return (b.createdAt || 0) - (a.createdAt || 0);
    }
  });

  // Supervisor Audit Clients
  const supervisorClients = clients.filter(c => {
    if (!c.aiRecommendation) return false;
    const rec = c.aiRecommendation;

    const hasSalesAction = rec.status === 'ACCEPTED' || rec.status === 'SKIPPED' || rec.salesCheckAt || rec.acceptedAt;
    if (!hasSalesAction) return false;

    if (selectedAgentId !== 'all' && c.salesAgentId !== selectedAgentId) {
      return false;
    }

    if (supervisorAuditFilter === 'pending_check') {
      if (rec.supervisorCheck) return false;
    } else if (supervisorAuditFilter === 'accepted') {
      if (rec.status !== 'ACCEPTED') return false;
    } else if (supervisorAuditFilter === 'skipped') {
      if (rec.status !== 'SKIPPED') return false;
    }

    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone.includes(searchQuery);
    return matchesSearch;
  }).sort((a, b) => {
    const aTime = a.aiRecommendation?.salesCheckAt || a.aiRecommendation?.acceptedAt || a.aiRecommendation?.generatedAt || 0;
    const bTime = b.aiRecommendation?.salesCheckAt || b.aiRecommendation?.acceptedAt || b.aiRecommendation?.generatedAt || 0;
    return bTime - aTime; // Newest sales action at top
  });

  // Calculate Classification Metrics
  const totalClientsCount = clients.length;
  const interestedClients = clients.filter(isClientInterested);
  const interestedClientsCount = interestedClients.length;

  const roundAnalyzedCount = interestedClients.filter(c => c.aiRecommendation?.round === currentRound).length;
  const roundTotalCount = interestedClients.length;
  const roundPercent = roundTotalCount > 0 ? Math.round((roundAnalyzedCount / roundTotalCount) * 100) : 0;

  const enrolledClientsCount = clients.filter(c => {
    const st = (c.status || '').toLowerCase().trim();
    return st.includes('حجز') || st.includes('مسجل') || st.includes('مستمر') || st.includes('enrolled') || st.includes('booked');
  }).length;

  const notInterestedClientsCount = clients.filter(c => {
    const st = (c.status || '').toLowerCase().trim();
    return st.includes('غير مهتم') || st.includes('not_interested') || st.includes('ملغي') || st.includes('مستبعد');
  }).length;

  const interestedOutdatedCount = interestedClients.filter(c => !c.aiRecommendation || (c.aiRecommendation.round || 0) < currentRound).length;
  
  const totalAnalyzed = clients.filter(c => !!c.aiRecommendation).length;
  const totalAccepted = clients.filter(c => c.aiRecommendation?.status === 'ACCEPTED').length;
  const totalSkipped = clients.filter(c => c.aiRecommendation?.status === 'SKIPPED').length;
  const pendingSupervisorCheckCount = clients.filter(c => {
    if (!c.aiRecommendation) return false;
    const rec = c.aiRecommendation;
    const hasSalesAction = rec.status === 'ACCEPTED' || rec.status === 'SKIPPED' || rec.salesCheckAt || rec.acceptedAt;
    return hasSalesAction && !rec.supervisorCheck;
  }).length;
  const highPriorityCount = clients.filter(c => c.aiRecommendation?.conversionPriority === 'عالي' && c.aiRecommendation?.status === 'PENDING').length;
  const outdatedCount = clients.filter(c => !c.aiRecommendation || (c.aiRecommendation.round || 0) < currentRound).length;

  return (
    <div className="space-y-8 dir-rtl">
      
      {/* Top Banner Header & Controls */}
      <div className="bg-gradient-to-l from-slate-900 via-indigo-950 to-slate-900 rounded-[3rem] p-8 lg:p-12 text-white shadow-2xl relative overflow-hidden border border-slate-800 space-y-6">
        <div className="absolute top-0 left-0 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl -ml-20 -mt-20 pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500/20 text-primary-300 rounded-2xl border border-primary-500/30 text-xs font-black">
                <Sparkles size={16} className="text-primary-400 animate-pulse" />
                <span>المساعد الذكي (مارو) - نظام إدارة الحصص والجولات</span>
              </div>

              <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-500/20 text-indigo-300 rounded-2xl border border-indigo-500/40 text-xs font-black">
                <Layers size={16} className="text-indigo-400" />
                <span>الجولة الحالية: Round {currentRound}</span>
              </div>
            </div>

            <h1 className="text-3xl lg:text-4xl font-black tracking-tight">تحليل العملاء بنظام الجولات (Round-based AI Analysis)</h1>
            <p className="text-slate-300 text-xs lg:text-sm font-bold max-w-2xl leading-relaxed">
              يتم تحليل جميع العملاء المؤهلين بالتتابع حتى إكمال الجولة (Round {currentRound}). لا يتم إعادة تحليل أي عميل تم فحصه بالراوند الحالي حتى اكتمال كافة العملاء والبدء في الراوند التالي.
            </p>

            {/* Round Progress Meter */}
            <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/80 max-w-xl space-y-2">
              <div className="flex justify-between items-center text-xs font-black">
                <span className="text-slate-300 flex items-center gap-2">
                  <Tag size={14} className="text-indigo-400" /> تقدم الجولة Round {currentRound}:
                </span>
                <span className="text-indigo-300">{roundAnalyzedCount} من {roundTotalCount} عميل ({roundPercent}%)</span>
              </div>
              <div className="w-full bg-slate-900 h-2.5 rounded-full overflow-hidden border border-slate-700/50">
                <div 
                  className="bg-gradient-to-r from-primary-500 via-indigo-500 to-emerald-400 h-full transition-all duration-500"
                  style={{ width: `${Math.min(100, roundPercent)}%` }}
                ></div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowKnowledgeModal(true)}
              className="px-4 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-black text-xs rounded-2xl transition flex items-center gap-2 shrink-0"
            >
              <BookOpen size={16} className="text-primary-400" />
              <span>قاعدة المعرفة</span>
            </button>

            {isAdmin ? (
              <>
                {/* UNDO / REVERT LAST BATCH BUTTON */}
                {lastBatchBackup && lastBatchBackup.clientBackups && lastBatchBackup.clientBackups.length > 0 && (
                  <button
                    onClick={handleRevertLastBatch}
                    disabled={isBatchAnalyzing || isRevertingBatch}
                    className="px-5 py-3.5 bg-rose-950/90 hover:bg-rose-900 text-rose-200 border border-rose-700/80 font-black text-xs rounded-2xl transition flex items-center gap-2 shrink-0 disabled:opacity-50 shadow-lg"
                    title="التراجع عن تحليل آخر دفعة واستعادة الحالة السابقة للعملاء"
                  >
                    <RotateCcw size={16} className={`text-rose-400 ${isRevertingBatch ? 'animate-spin' : ''}`} />
                    <span>
                      {isRevertingBatch
                        ? 'جاري التراجع...'
                        : `التراجع عن تحليل آخر دفعة (${lastBatchBackup.count} عميل) ↩️`}
                    </span>
                  </button>
                )}

                <button
                  onClick={() => setShowBatchConfigModal(true)}
                  disabled={isBatchAnalyzing || isRevertingBatch}
                  className="px-4 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 font-black text-xs rounded-2xl transition flex items-center gap-2 shrink-0"
                  title="تحديد السيلز الشغالين وحصة كل سيلز اليومية"
                >
                  <SlidersHorizontal size={16} className="text-amber-400" />
                  <span>السيلز الشغالين ({selectedActiveAgentIds.length}) & الحصة ({perAgentQuota}) ⚙️</span>
                </button>

                <button
                  onClick={handleStartNextRoundManually}
                  disabled={isBatchAnalyzing || isRevertingBatch}
                  className="px-5 py-3.5 bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 border border-indigo-700/80 font-black text-xs rounded-2xl transition flex items-center gap-2 shrink-0 disabled:opacity-50"
                  title="إغلاق الجولة الحالية والبدء في الجولة التالية لإتاحة جميع العملاء للتحليل من جديد"
                >
                  <RotateCcw size={16} className="text-indigo-400" />
                  <span>بدء راوند جديد (Round {currentRound + 1}) 🔄</span>
                </button>

                <button
                  onClick={() => handleBatchAnalyze()}
                  disabled={isBatchAnalyzing || isRevertingBatch}
                  className="px-7 py-3.5 bg-gradient-to-r from-primary-500 to-indigo-600 hover:from-primary-600 hover:to-indigo-700 text-white font-black text-xs uppercase rounded-2xl shadow-xl transition-all flex items-center gap-3 shrink-0 disabled:opacity-50"
                >
                  {isBatchAnalyzing ? (
                    <>
                      <RefreshCw className="animate-spin" size={18} />
                      <span>جاري تحليل الدفعة ({batchProgress}%)...</span>
                    </>
                  ) : (
                    <>
                      <Zap size={18} />
                      <span>تشغيل دفعة اليوم ({selectedActiveAgentIds.length * perAgentQuota} عميل - Round {currentRound})</span>
                    </>
                  )}
                </button>
              </>
            ) : (
              <button
                onClick={() => handleBatchAnalyze()}
                disabled={isBatchAnalyzing}
                className="px-7 py-3.5 bg-gradient-to-r from-primary-500 via-indigo-600 to-purple-600 hover:from-primary-600 hover:to-indigo-700 text-white font-black text-xs uppercase rounded-2xl shadow-xl transition-all flex items-center gap-3 shrink-0 disabled:opacity-50"
              >
                {isBatchAnalyzing ? (
                  <>
                    <RefreshCw className="animate-spin" size={18} />
                    <span>جاري تشغيل تحليل مارو لعملائي ({batchProgress}%)...</span>
                  </>
                ) : (
                  <>
                    <Zap size={18} className="text-amber-300" />
                    <span>تشغيل اقتراحات مارو لعملائي (دفعة {perAgentQuota} عميل - Round {currentRound}) ✨</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Customizable Batch Size & Filter Controls Bar */}
        <div className="relative z-10 pt-4 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-12 gap-4 items-center text-xs">
          
          {/* Checkbox: Ignore Not Interested & Booked */}
          <div className="md:col-span-5 flex items-center gap-3 bg-slate-800/60 p-3.5 rounded-2xl border border-slate-700/60">
            <Filter size={16} className="text-primary-400 shrink-0" />
            <label className="font-bold text-slate-300 flex items-center gap-2 cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={onlyInterested} 
                onChange={(e) => setOnlyInterested(e.target.checked)}
                className="w-4 h-4 rounded text-primary-500 focus:ring-primary-500 bg-slate-900 border-slate-700"
              />
              <span>تجاهل غير المهتمين والذين حجزوا بالفعل (التركيز على من لم يحجز بعد)</span>
            </label>
          </div>

          {/* Quota Per Active Agent Input & Summary */}
          <div className="md:col-span-7 flex flex-wrap items-center justify-between gap-3 bg-slate-800/60 p-3.5 rounded-2xl border border-slate-700/60">
            <div className="flex items-center gap-2">
              <span className="font-black text-slate-300 shrink-0">حصة كل سيلز شغال:</span>
              <input 
                type="number"
                min={1}
                max={500}
                value={perAgentQuota}
                onChange={(e) => setPerAgentQuota(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 bg-slate-900 text-white font-black text-center border border-slate-700 rounded-xl px-2 py-1 focus:outline-none focus:border-primary-500"
              />
              <span className="text-slate-400 font-bold">عميل/سيلز</span>
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-slate-400 font-bold ml-1">تحديد حصة السيلز:</span>
              {[10, 15, 20, 25, 30, 50].map(quota => (
                <button
                  key={quota}
                  onClick={() => setPerAgentQuota(quota)}
                  className={`px-2.5 py-1 rounded-lg font-black text-[11px] transition ${
                    perAgentQuota === quota 
                      ? 'bg-primary-500 text-white shadow' 
                      : 'bg-slate-900 text-slate-300 hover:bg-slate-700 border border-slate-700'
                  }`}
                >
                  {quota} عميل
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Batch Progress Bar */}
        {isBatchAnalyzing && (
          <div className="relative z-10 space-y-2 pt-2">
            <div className="flex justify-between text-xs font-black text-slate-300">
              <span>جاري المعالجة المتوازية السريعة بالذكاء الاصطناعي...</span>
              <span>{batchProgress}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700">
              <div 
                className="bg-gradient-to-r from-primary-500 via-indigo-500 to-emerald-400 h-full rounded-full transition-all duration-300"
                style={{ width: `${batchProgress}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>

      {/* Categorization & Client Breakdown Statistics Panel */}
      <div className="space-y-3">
        <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center gap-2 px-2">
          <Filter size={14} className="text-primary-500" />
          <span>إحصائيات وتصنيف العملاء في قاعدة البيانات</span>
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          
          <div className="bg-white dark:bg-slate-900 p-5 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm space-y-1">
            <p className="text-[11px] font-black text-slate-400 uppercase">إجمالي قاعدة البيانات</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white">{totalClientsCount}</p>
            <p className="text-[10px] text-slate-500 font-bold">كل المسجلين بالنظام</p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-5 rounded-[2rem] border border-emerald-100 dark:border-emerald-950/50 shadow-sm space-y-1 bg-emerald-50/20 dark:bg-emerald-950/10">
            <p className="text-[11px] font-black text-emerald-600 dark:text-emerald-400 uppercase">المهتمون والمحتملون (لم يحجزوا)</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{interestedClientsCount}</p>
            <p className="text-[10px] text-emerald-600/80 font-bold">مستهدفون بالمتابعة البيعية AI</p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-5 rounded-[2rem] border border-blue-100 dark:border-blue-950/50 shadow-sm space-y-1 bg-blue-50/20 dark:bg-blue-950/10">
            <p className="text-[11px] font-black text-blue-600 dark:text-blue-400 uppercase">حجزوا وانضموا بالفعل 🎉</p>
            <p className="text-2xl font-black text-blue-600 dark:text-blue-400">{enrolledClientsCount}</p>
            <p className="text-[10px] text-blue-600/80 font-bold">خارج دائرة المتابعة البيعية</p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-5 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-sm space-y-1 bg-slate-50/50 dark:bg-slate-800/20">
            <p className="text-[11px] font-black text-slate-400 uppercase">غير المهتمين / المستبعدون</p>
            <p className="text-2xl font-black text-slate-500 dark:text-slate-400">{notInterestedClientsCount}</p>
            <p className="text-[10px] text-slate-400 font-bold">مستبعدون لتوفير الكوتا</p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-5 rounded-[2rem] border border-amber-100 dark:border-amber-950/50 shadow-sm space-y-1 bg-amber-50/20 dark:bg-amber-950/10 col-span-2 sm:col-span-1">
            <p className="text-[11px] font-black text-amber-600 dark:text-amber-400 uppercase">بانتظار تحديث اليوم</p>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-400">{interestedOutdatedCount}</p>
            <p className="text-[10px] text-amber-600/80 font-bold">مهتمون بحاجة لتحديث</p>
          </div>

        </div>
      </div>

      {/* Knowledge Base Modal */}
      {showKnowledgeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-8 max-w-4xl w-full max-h-[85vh] overflow-y-auto border border-slate-200 dark:border-slate-800 space-y-6 shadow-2xl relative">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-primary-500/10 text-primary-500 rounded-2xl flex items-center justify-center font-black">
                  <Award size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 dark:text-white">قاعدة معرفة أكاديمية صابر جروب (SABER GROUP)</h3>
                  <p className="text-xs font-bold text-slate-400">المرجع الذي يتغذى عليه الذكاء الاصطناعي لتحليل المتدربين</p>
                </div>
              </div>
              <button 
                onClick={() => setShowKnowledgeModal(false)}
                className="p-3 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-2xl hover:bg-slate-200 transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              
              <div className="bg-primary-500/10 p-5 rounded-3xl border border-primary-500/20 space-y-2">
                <h4 className="font-black text-sm text-primary-600 dark:text-primary-400 flex items-center gap-2">
                  <Gift size={18} /> كوبون تجربة المساعد الذكي (مارو):
                </h4>
                <p className="font-bold">
                  عند تجربة العميل للمساعد الذكي "مارو"، يتم منحه كوبون خصم إضافي بقيمة <strong>400 جنيه</strong> صالح لمدة <strong>24 ساعة فقط</strong> لتشجيعه على التثبيت والحجز الفوري!
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50 dark:bg-slate-800 p-5 rounded-3xl border border-slate-100 dark:border-slate-700 space-y-2">
                  <h4 className="font-black text-slate-900 dark:text-white text-sm">1. كورس الجرافيك الأساسي (من الصفر)</h4>
                  <ul className="space-y-1 text-slate-500 dark:text-slate-400">
                    <li>• <strong>المدة:</strong> 2.5 إلى 3 شهور (سيشنين/أسبوع، 3 ساعات للسيشن)</li>
                    <li>• <strong>الأماكن:</strong> أونلاين (Google Meet مسجل) أو أوفلاين بمقر طنطا (شارع البنداري - الاستاد)</li>
                    <li>• <strong>البرامج والورش:</strong> فوتوشوب - إليستريتور - إن ديزاين - ورشة الـ AI</li>
                    <li>• <strong>السعر:</strong> 5500 ج (كامل) | <strong>الحجز المبكر: 3500 ج</strong></li>
                  </ul>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800 p-5 rounded-3xl border border-slate-100 dark:border-slate-700 space-y-2">
                  <h4 className="font-black text-slate-900 dark:text-white text-sm">2. كورس المستوى المتقدم (AI Advertising)</h4>
                  <ul className="space-y-1 text-slate-500 dark:text-slate-400">
                    <li>• <strong>الفئة:</strong> للمصممين الممارسين لتطوير مستواهم عالمياً</li>
                    <li>• <strong>الميزة:</strong> تنشر أبحاثهم ومشاريعهم على Ads of the World</li>
                    <li>• <strong>المحاور:</strong> AI Workflows، الإضاءة والدمج، الماركتنج والبريف، مهارات التسعير</li>
                    <li>• <strong>السعر:</strong> 6000 ج (كامل) | <strong>الحجز المبكر: 4500 ج</strong></li>
                  </ul>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800 p-5 rounded-3xl border border-slate-100 dark:border-slate-700 space-y-2">
                <h4 className="font-black text-slate-900 dark:text-white text-sm">سياسة التقسيط والرد على الاعتراضات</h4>
                <ul className="space-y-2 text-slate-600 dark:text-slate-300">
                  <li>• <strong>نظام التقسيط:</strong> عربون بسيط للحجز والباقي بالتقسيط المريح بدون فوائد مع خدمة العملاء.</li>
                  <li>• <strong>اعتراض عدم توفر لابتوب:</strong> الجهاز ليس شرطاً أساسياً في البداية ويمكن التعاون في ترتيب خطة دراسية تناسب الإمكانيات.</li>
                  <li>• <strong>اعتراض الشغف:</strong> الشغف يأتي مع رؤية نتائج التطبيق الفعلي للمحاضرات الأولى.</li>
                  <li>• <strong>تأكيد الحجز:</strong> يتم تحويل الحجز النهائي لواتساب خدمة العملاء الرسمي: <strong>01040784390</strong>.</li>
                </ul>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 rounded-2xl flex items-center justify-center shrink-0">
            <Bot size={28} />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase">إجمالي العملاء المحللين</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">{totalAnalyzed}</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
            <CheckCircle2 size={28} />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase">المُحول للمتابعة (مبيعات)</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{totalAccepted}</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-purple-50 dark:bg-purple-500/10 text-purple-600 rounded-2xl flex items-center justify-center shrink-0">
            <XCircle size={28} />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase">المتخطي (Skipped)</p>
            <p className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">{totalSkipped}</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-amber-50 dark:bg-amber-500/10 text-amber-600 rounded-2xl flex items-center justify-center shrink-0">
            <ShieldAlert size={28} />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase">بانتظار تأكيد المشرف (Check 2)</p>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{pendingSupervisorCheckCount}</p>
          </div>
        </div>

      </div>

      {/* Main View Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab('sales_queue')}
            className={`px-6 py-3.5 rounded-2xl font-black text-xs transition flex items-center gap-2 ${
              activeTab === 'sales_queue'
                ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Bot size={18} />
            <span>🤖 توصيات المساعد الذكي (إجراءات المبيعات)</span>
          </button>

          <button
            onClick={() => setActiveTab('supervisor_audit')}
            className={`px-6 py-3.5 rounded-2xl font-black text-xs transition flex items-center gap-2 relative ${
              activeTab === 'supervisor_audit'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <Shield size={18} />
            <span>🛡️ تابة المشرف والاعتمادات (Supervisor Audit)</span>
            {pendingSupervisorCheckCount > 0 && (
              <span className="px-2 py-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full animate-bounce">
                {pendingSupervisorCheckCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* VIEW TAB 1: SALES QUEUE & AI RECOMMENDATIONS */}
      {activeTab === 'sales_queue' && (
        <div className="space-y-6">
          
          {/* Filter & Sort Controls Bar */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4">
              
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder="ابحث باسم العميل أو رقم الهاتف..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 text-xs font-black p-4 pr-11 rounded-2xl border border-slate-200 dark:border-slate-700 outline-none focus:border-primary-500 dark:text-white"
                />
                <Filter size={18} className="absolute right-4 top-4 text-slate-400" />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                
                {/* SORT OPTION FILTER (Newest AI Analysis First) */}
                <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/40 p-2 rounded-2xl border border-indigo-200 dark:border-indigo-800/60">
                  <ArrowUpDown size={16} className="text-indigo-600 dark:text-indigo-400 mr-1" />
                  <span className="text-[11px] font-black text-indigo-700 dark:text-indigo-300">الترتيب:</span>
                  <select
                    value={sortOption}
                    onChange={e => setSortOption(e.target.value as any)}
                    className="bg-transparent text-xs font-black outline-none text-indigo-900 dark:text-indigo-200"
                  >
                    <option value="newest_ai">⚡ أحدث ما تم تحليله بالذكاء الاصطناعي أولاً</option>
                    <option value="priority">🔥 الأعلى أولوية</option>
                    <option value="round">🏷️ حسب رقم الجولة (Round)</option>
                    <option value="newest_client">📅 أحدث التسجيلات بالداتابيز</option>
                  </select>
                </div>

                {isHighRole && (
                  <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700">
                    <UserCheck size={16} className="text-slate-400 mr-2" />
                    <select
                      value={selectedAgentId}
                      onChange={e => setSelectedAgentId(e.target.value)}
                      className="bg-transparent text-xs font-black outline-none dark:text-white"
                    >
                      <option value="all">جميع مسؤولي المبيعات</option>
                      {salesAgents.map(a => (
                        <option key={a.uid} value={a.uid}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-center bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs font-black flex-wrap">
                  <button
                    onClick={() => setStatusFilter('pending')}
                    className={`px-3.5 py-2 rounded-xl transition ${statusFilter === 'pending' ? 'bg-primary-500 text-white shadow' : 'text-slate-500'}`}
                  >
                    بانتظار الأكشن ({clients.filter(c => c.aiRecommendation?.status === 'PENDING').length})
                  </button>
                  <button
                    onClick={() => setStatusFilter('accepted')}
                    className={`px-3.5 py-2 rounded-xl transition ${statusFilter === 'accepted' ? 'bg-emerald-600 text-white shadow' : 'text-slate-500'}`}
                  >
                    مُحول للمتابعة ({totalAccepted})
                  </button>
                  <button
                    onClick={() => setStatusFilter('skipped')}
                    className={`px-3.5 py-2 rounded-xl transition ${statusFilter === 'skipped' ? 'bg-purple-600 text-white shadow' : 'text-slate-500'}`}
                  >
                    متخطي Skipped ({totalSkipped})
                  </button>
                  <button
                    onClick={() => setStatusFilter('outdated')}
                    className={`px-3.5 py-2 rounded-xl transition ${statusFilter === 'outdated' ? 'bg-amber-500 text-white shadow' : 'text-slate-500'}`}
                  >
                    قديم
                  </button>
                  <button
                    onClick={() => setStatusFilter('all')}
                    className={`px-3.5 py-2 rounded-xl transition ${statusFilter === 'all' ? 'bg-primary-500 text-white shadow' : 'text-slate-500'}`}
                  >
                    الكل
                  </button>
                </div>

                <select
                  value={priorityFilter}
                  onChange={e => setPriorityFilter(e.target.value)}
                  className="bg-slate-50 dark:bg-slate-800 text-xs font-black p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 outline-none dark:text-white"
                >
                  <option value="all">كل الأولويات</option>
                  <option value="عالي">عالي الأولوية</option>
                  <option value="متوسط">متوسط الأولوية</option>
                  <option value="منخفض">منخفض الأولوية</option>
                </select>
              </div>

            </div>
          </div>

          {/* AI Recommendations Cards List */}
          {loading ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-[3rem] space-y-4">
              <RefreshCw className="animate-spin text-primary-500 mx-auto" size={36} />
              <p className="text-xs font-black text-slate-500">جاري جلب توصيات المساعد الذكي صابر جروب...</p>
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-[3rem] space-y-4 border border-slate-100 dark:border-slate-800">
              <Bot size={48} className="text-slate-300 mx-auto" />
              <h3 className="text-base font-black text-slate-700 dark:text-slate-200">لا توجد توصيات مطابقة للفلاتر</h3>
              <p className="text-xs text-slate-400 font-bold max-w-sm mx-auto">
                يمكنك تشغيل تحليل الدفعة ليقوم الذكاء الاصطناعي بتوليد توصيات مميزة لكل موظف مبيعات.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {filteredClients.map(client => {
                const rec = client.aiRecommendation;
                const isAnalyzingThis = analyzingClientId === client.id;

                return (
                  <div 
                    key={client.id}
                    className={`bg-white dark:bg-slate-900 rounded-[2.5rem] p-7 border-2 transition-all shadow-md flex flex-col justify-between space-y-6 ${
                      rec?.status === 'ACCEPTED'
                        ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/10'
                        : rec?.status === 'SKIPPED'
                        ? 'border-purple-200 dark:border-purple-900/50 bg-purple-50/10'
                        : rec?.conversionPriority === 'عالي'
                        ? 'border-rose-200 dark:border-rose-900/50 bg-rose-50/20 dark:bg-rose-950/10'
                        : 'border-slate-100 dark:border-slate-800'
                    }`}
                  >
                    {/* Header Info */}
                    <div className="space-y-4">
                      <div className="flex justify-between items-start gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 
                              onClick={() => navigate(`/clients/${client.id}`)}
                              className="text-lg font-black text-slate-900 dark:text-white hover:text-primary-500 cursor-pointer transition"
                            >
                              {client.name}
                            </h3>
                            <span className="text-[10px] font-black px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg">
                              {client.bookedCourseName || client.serviceName || 'دورة جرافيك'}
                            </span>
                          </div>
                          <p className="text-xs font-bold text-slate-400 mt-1" dir="ltr">{client.phone}</p>
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          {rec ? (
                            <>
                              <span className={`px-3 py-1.5 rounded-xl text-[10px] font-black flex items-center gap-1 shrink-0 ${
                                rec.conversionPriority === 'عالي'
                                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                  : rec.conversionPriority === 'متوسط'
                                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                  : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                              }`}>
                                <Sparkles size={12} /> أولوية {rec.conversionPriority}
                              </span>

                              <span className="px-2.5 py-1 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 rounded-xl text-[10px] font-black flex items-center gap-1 shrink-0">
                                <Tag size={12} className="text-indigo-500" /> Round {rec.round || 1}
                              </span>
                            </>
                          ) : (
                            <span className="text-[10px] font-black px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-xl">لم يحلل بعد</span>
                          )}

                          {rec?.generatedAt && (
                            <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                              <Clock size={10} /> تحليل: {new Date(rec.generatedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Agent and Status meta */}
                      <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold text-slate-500">
                        <span>المسؤول: <strong className="text-slate-800 dark:text-slate-200">{client.salesAgentName}</strong></span>
                        <span>•</span>
                        <span>الحالة: <strong className="text-slate-800 dark:text-slate-200">{client.status}</strong></span>
                      </div>

                      {/* AI Recommendation Details */}
                      {rec ? (
                        <div className="space-y-4 bg-slate-50 dark:bg-slate-800/60 p-5 rounded-3xl border border-slate-100 dark:border-slate-800">
                          
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl flex items-center gap-2 border border-slate-100 dark:border-slate-800">
                              <Calendar size={16} className="text-primary-500 shrink-0" />
                              <div>
                                <p className="text-[9px] font-black text-slate-400">الموعد المقترح</p>
                                <p className="font-black text-slate-800 dark:text-slate-200">{rec.suggestedDate} ({rec.suggestedTime || '12:00'})</p>
                              </div>
                            </div>

                            <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl flex items-center gap-2 border border-slate-100 dark:border-slate-800">
                              <MessageSquare size={16} className="text-indigo-500 shrink-0" />
                              <div>
                                <p className="text-[9px] font-black text-slate-400">قناة التواصل</p>
                                <p className="font-black text-indigo-600 dark:text-indigo-400">{rec.suggestedChannel}</p>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="text-[10px] font-black text-slate-400 uppercase">رأي وتحليل الذكاء الاصطناعي:</p>
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-300 leading-relaxed">{rec.insightsSummary}</p>
                          </div>

                          <div className="space-y-1 bg-primary-500/5 p-4 rounded-2xl border border-primary-500/10 relative">
                            <div className="flex justify-between items-center mb-1">
                              <p className="text-[10px] font-black text-primary-600 dark:text-primary-400 flex items-center gap-1">
                                <Sparkles size={12} /> سيناريو الإقناع (صابر جروب):
                              </p>
                              <button
                                onClick={() => copyPitchToClipboard(client.id, rec.suggestedPitch)}
                                className="text-[10px] font-black text-slate-500 hover:text-primary-500 flex items-center gap-1 bg-white dark:bg-slate-900 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700"
                              >
                                {copiedClientId === client.id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                                <span>{copiedClientId === client.id ? 'تم النسخ' : 'نسخ النص'}</span>
                              </button>
                            </div>
                            <p className="text-xs font-bold text-slate-800 dark:text-slate-100 leading-relaxed">{rec.suggestedPitch}</p>
                          </div>

                          {/* CHECK 1: SALES ACTION & COMMENT BOX */}
                          <div className="p-4 rounded-2xl border space-y-2 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                            <div className="flex justify-between items-center">
                              <span className="text-[11px] font-black text-slate-500 flex items-center gap-1.5">
                                <CheckSquare size={14} className="text-primary-500" />
                                <span>Check 1 (المبيعات):</span>
                              </span>

                              {rec.status === 'ACCEPTED' && (
                                <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl text-[10px] font-black flex items-center gap-1">
                                  <CheckCircle2 size={12} /> تم التحويل للمتابعة
                                </span>
                              )}

                              {rec.status === 'SKIPPED' && (
                                <span className="px-2.5 py-1 bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 rounded-xl text-[10px] font-black flex items-center gap-1">
                                  <XCircle size={12} /> تم التخطي (Skipped)
                                </span>
                              )}

                              {rec.status === 'PENDING' && (
                                <span className="px-2.5 py-1 bg-amber-500/10 text-amber-600 border border-amber-500/20 rounded-xl text-[10px] font-black">
                                  بانتظار قرار السيلز ⏳
                                </span>
                              )}
                            </div>

                            {rec.acceptedByName && (
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                مسؤول المبيعات: <span className="text-primary-600 dark:text-primary-400 font-black">{rec.acceptedByName}</span>
                              </p>
                            )}

                            {rec.salesComment ? (
                              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-700/60">
                                <span className="text-[10px] font-black text-slate-400 block mb-0.5">💬 رأي وملاحظات السيلز:</span>
                                {rec.salesComment}
                              </div>
                            ) : rec.status !== 'PENDING' ? (
                              <p className="text-[11px] text-slate-400 font-bold italic">لا توجد ملاحظات مدونة من السيلز</p>
                            ) : null}
                          </div>

                          {/* CHECK 2: SUPERVISOR STATUS BOX */}
                          {(rec.supervisorCheck || rec.supervisorNotes) && (
                            <div className="p-4 rounded-2xl border space-y-2 bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-800/40">
                              <div className="flex justify-between items-center">
                                <span className="text-[11px] font-black text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                                  <Shield size={14} className="text-indigo-500" />
                                  <span>Check 2 (المشرف):</span>
                                </span>
                                {rec.supervisorCheck && (
                                  <span className="px-2.5 py-1 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 rounded-xl text-[10px] font-black flex items-center gap-1">
                                    <CheckCheck size={12} /> تم العلم والاعتماد (Acknowledge)
                                  </span>
                                )}
                              </div>

                              {rec.supervisorCheckedByName && (
                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                  المشرف المعتمد: <span className="text-indigo-600 dark:text-indigo-400 font-black">{rec.supervisorCheckedByName}</span>
                                </p>
                              )}

                              {rec.supervisorNotes && (
                                <div className="p-3 bg-white dark:bg-slate-900 rounded-xl text-xs font-bold text-indigo-900 dark:text-indigo-200 border border-indigo-100 dark:border-indigo-800">
                                  <span className="text-[10px] font-black text-indigo-500 block mb-0.5">📌 توجيهات المشرف:</span>
                                  {rec.supervisorNotes}
                                </div>
                              )}
                            </div>
                          )}

                        </div>
                      ) : (
                        <div className="p-6 text-center bg-slate-50 dark:bg-slate-800 rounded-3xl space-y-2">
                          <p className="text-xs font-bold text-slate-500">لم يتم استخراج اقتراحات مارو (AI) بعد لهذا العميل.</p>
                          <button
                            onClick={() => handleAnalyzeClient(client)}
                            disabled={isAnalyzingThis}
                            className="px-4 py-2.5 bg-gradient-to-r from-primary-500 to-indigo-600 hover:from-primary-600 hover:to-indigo-700 text-white rounded-xl text-xs font-black shadow transition flex items-center justify-center gap-2 mx-auto disabled:opacity-50"
                          >
                            <Sparkles size={14} className={isAnalyzingThis ? 'animate-spin' : ''} />
                            <span>{isAnalyzingThis ? 'جاري استخراج اقتراحات مارو...' : '✨ استخراج اقتراحات مارو الآن'}</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Footer Mandatory Actions for Sales */}
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap justify-between items-center gap-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAnalyzeClient(client)}
                          disabled={isAnalyzingThis}
                          className="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-primary-50 hover:text-primary-600 dark:hover:bg-slate-700 rounded-2xl text-xs font-black transition flex items-center gap-1.5"
                          title="إعادة استخراج اقتراحات مارو للعميل"
                        >
                          <RefreshCw size={14} className={isAnalyzingThis ? 'animate-spin text-primary-500' : ''} />
                          <span className="text-[10px]">{isAnalyzingThis ? 'جاري التحديث...' : 'تحديث اقتراحات مارو'}</span>
                        </button>
                      </div>

                      {/* SALES ACTION BUTTONS (MANDATORY SELECTION) */}
                      {rec && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => {
                              setActionModalClient(client);
                              setActionModalType('SKIP');
                              setSalesCommentInput(rec.salesComment || '');
                            }}
                            className={`px-4 py-3 rounded-2xl font-black text-xs transition flex items-center gap-1.5 ${
                              rec.status === 'SKIPPED'
                                ? 'bg-purple-600 text-white shadow'
                                : 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 hover:bg-purple-100 border border-purple-200 dark:border-purple-800'
                            }`}
                          >
                            <XCircle size={15} />
                            <span>{rec.status === 'SKIPPED' ? 'تخطي (تم)' : 'تخطي (Skip)'}</span>
                          </button>

                          <button
                            onClick={() => {
                              setActionModalClient(client);
                              setActionModalType('ACCEPT');
                              setSalesCommentInput(rec.salesComment || '');
                            }}
                            className={`px-5 py-3 rounded-2xl font-black text-xs transition flex items-center gap-1.5 ${
                              rec.status === 'ACCEPTED'
                                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow'
                            }`}
                          >
                            <CheckCircle2 size={15} />
                            <span>{rec.status === 'ACCEPTED' ? 'تم التحويل للمتابعة' : 'تحويل للمتابعة'}</span>
                          </button>
                        </div>
                      )}
                    </div>

                  </div>
                );
              })}
            </div>
          )}

        </div>
      )}

      {/* VIEW TAB 2: SUPERVISOR AUDIT & ACKNOWLEDGEMENT */}
      {activeTab === 'supervisor_audit' && (
        <div className="space-y-6">
          
          <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4">
              
              <div>
                <h3 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2">
                  <Shield className="text-indigo-500" size={20} />
                  <span>لوحة المشرف - متابعة اعتمادات المبيعات والـ Checks</span>
                </h3>
                <p className="text-xs font-bold text-slate-400 mt-1">
                  مراجعة إجراءات موظفي المبيعات (التحويلات والتخطي) وتأكيد العلم والاطلاع (Check 2) أو إعادة العملاء للمتابعة بأمر المشرف.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs font-black">
                  <button
                    onClick={() => setSupervisorAuditFilter('all')}
                    className={`px-4 py-2.5 rounded-xl transition ${supervisorAuditFilter === 'all' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500'}`}
                  >
                    الكل ({supervisorClients.length})
                  </button>
                  <button
                    onClick={() => setSupervisorAuditFilter('pending_check')}
                    className={`px-4 py-2.5 rounded-xl transition ${supervisorAuditFilter === 'pending_check' ? 'bg-amber-500 text-white shadow' : 'text-slate-500'}`}
                  >
                    بانتظار الاطلاع ⏳ ({pendingSupervisorCheckCount})
                  </button>
                  <button
                    onClick={() => setSupervisorAuditFilter('accepted')}
                    className={`px-4 py-2.5 rounded-xl transition ${supervisorAuditFilter === 'accepted' ? 'bg-emerald-600 text-white shadow' : 'text-slate-500'}`}
                  >
                    التحويلات
                  </button>
                  <button
                    onClick={() => setSupervisorAuditFilter('skipped')}
                    className={`px-4 py-2.5 rounded-xl transition ${supervisorAuditFilter === 'skipped' ? 'bg-purple-600 text-white shadow' : 'text-slate-500'}`}
                  >
                    التخطي (Skipped)
                  </button>
                </div>
              </div>

            </div>
          </div>

          {supervisorClients.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-[3rem] space-y-4 border border-slate-100 dark:border-slate-800">
              <Shield size={48} className="text-indigo-300 mx-auto" />
              <h3 className="text-base font-black text-slate-700 dark:text-slate-200">لا توجد إجراءات مبيعات مطابقة للعرض</h3>
              <p className="text-xs text-slate-400 font-bold max-w-sm mx-auto">
                عندما يقوم موظفو المبيعات بتحويل العملاء للمتابعة أو عمل Skipped ستظهر إجراءاتهم هنا مباشرة للمشرف.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {supervisorClients.map(client => {
                const rec = client.aiRecommendation!;

                return (
                  <div 
                    key={client.id}
                    className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-7 border-2 border-indigo-100 dark:border-indigo-950/50 shadow-md flex flex-col justify-between space-y-6"
                  >
                    <div className="space-y-4">
                      
                      {/* Top Client & Sales Meta */}
                      <div className="flex justify-between items-start gap-4">
                        <div>
                          <h3 
                            onClick={() => navigate(`/clients/${client.id}`)}
                            className="text-lg font-black text-slate-900 dark:text-white hover:text-indigo-600 cursor-pointer transition"
                          >
                            {client.name}
                          </h3>
                          <p className="text-xs font-bold text-slate-400 mt-0.5" dir="ltr">{client.phone}</p>
                          <p className="text-[11px] font-black text-indigo-600 dark:text-indigo-400 mt-1">
                            الدورة: {client.bookedCourseName || client.serviceName || 'دورة جرافيك'}
                          </p>
                        </div>

                        <div className="flex flex-col items-end gap-1.5">
                          {rec.status === 'ACCEPTED' ? (
                            <span className="px-3 py-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl text-xs font-black flex items-center gap-1">
                              <CheckCircle2 size={14} /> تم تحويله للمتابعة
                            </span>
                          ) : (
                            <span className="px-3 py-1.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 rounded-xl text-xs font-black flex items-center gap-1">
                              <XCircle size={14} /> تم التخطي (Skipped)
                            </span>
                          )}

                          <span className="text-[10px] font-black px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 rounded-lg">
                            Round {rec.round || 1}
                          </span>
                        </div>
                      </div>

                      {/* Check 1: Sales Agent Detail */}
                      <div className="bg-slate-50 dark:bg-slate-800/80 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-black text-slate-500 flex items-center gap-1">
                            <UserCheck size={14} className="text-primary-500" />
                            <span>إجراء مسئول المبيعات (Check 1):</span>
                          </span>
                          {rec.salesCheckAt && (
                            <span className="text-[10px] font-bold text-slate-400">
                              {new Date(rec.salesCheckAt).toLocaleDateString('ar-EG')} - {new Date(rec.salesCheckAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>

                        <p className="text-xs font-black text-slate-800 dark:text-slate-100">
                          الموظف: <span className="text-primary-600 dark:text-primary-400">{rec.acceptedByName || client.salesAgentName}</span>
                        </p>

                        <div className="p-3 bg-white dark:bg-slate-900 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-800">
                          <span className="text-[10px] font-black text-slate-400 block mb-0.5">💬 رأي وملاحظات السيلز:</span>
                          {rec.salesComment || 'لا توجد ملاحظات مدونة'}
                        </div>
                      </div>

                      {/* AI Pitch Preview */}
                      <div className="p-3 bg-primary-500/5 rounded-xl border border-primary-500/10 text-xs font-bold text-slate-700 dark:text-slate-300 space-y-1">
                        <p className="text-[10px] font-black text-primary-600 flex items-center gap-1">
                          <Sparkles size={12} /> سيناريو AI المقترح:
                        </p>
                        <p className="leading-relaxed line-clamp-2">{rec.suggestedPitch}</p>
                      </div>

                      {/* Check 2: Supervisor Status */}
                      <div className={`p-4 rounded-2xl border space-y-2 ${
                        rec.supervisorCheck 
                          ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800' 
                          : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                      }`}>
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] font-black flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                            <Shield size={14} className="text-indigo-500" />
                            <span>تأكيد واطلاع المشرف (Check 2):</span>
                          </span>
                          {rec.supervisorCheck ? (
                            <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 rounded-xl text-[10px] font-black flex items-center gap-1">
                              <CheckCheck size={12} /> تم الاطلاع والعلم
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 bg-amber-500/10 text-amber-600 border border-amber-500/20 rounded-xl text-[10px] font-black">
                              بانتظار اطلاع المشرف ⏳
                            </span>
                          )}
                        </div>

                        {rec.supervisorCheckedByName && (
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            اسم المشرف: <span className="text-indigo-600 dark:text-indigo-400 font-black">{rec.supervisorCheckedByName}</span>
                          </p>
                        )}

                        {rec.supervisorNotes && (
                          <p className="text-xs font-bold text-indigo-900 dark:text-indigo-200 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-indigo-100 dark:border-indigo-800">
                            📌 أمر وتوجيه المشرف: {rec.supervisorNotes}
                          </p>
                        )}
                      </div>

                    </div>

                    {/* Supervisor Action Buttons */}
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap justify-end gap-3">
                      
                      {/* Override Button: Re-assign back to active follow-up */}
                      <button
                        onClick={() => {
                          setSupervisorModalClient(client);
                          setSupervisorNoteInput(rec.supervisorNotes || '');
                        }}
                        className="px-4 py-2.5 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 hover:bg-indigo-100 border border-indigo-200 dark:border-indigo-800 rounded-2xl text-xs font-black transition flex items-center gap-1.5"
                      >
                        <RotateCcw size={14} />
                        <span>إعادة للمتابعة بأمر المشرف 🔄</span>
                      </button>

                      {/* Acknowledge Button */}
                      {!rec.supervisorCheck && (
                        <button
                          onClick={() => handleSupervisorAcknowledge(client)}
                          className="px-5 py-2.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-2xl text-xs font-black transition flex items-center gap-1.5 shadow"
                        >
                          <CheckCheck size={16} />
                          <span>تأكيد واطلاع المشرف (Acknowledge)</span>
                        </button>
                      )}

                    </div>

                  </div>
                );
              })}
            </div>
          )}

        </div>
      )}

      {/* SALES ACTION MODAL (MANDATORY SELECTION & COMMENT) */}
      {actionModalClient && actionModalType && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-7 max-w-lg w-full border border-slate-200 dark:border-slate-800 space-y-6 shadow-2xl relative">
            
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black ${
                  actionModalType === 'ACCEPT' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-purple-500/10 text-purple-600'
                }`}>
                  {actionModalType === 'ACCEPT' ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    {actionModalType === 'ACCEPT' ? 'تحويل العميل للمتابعة البيعية' : 'تخطي العميل (Skipped)'}
                  </h3>
                  <p className="text-xs font-bold text-slate-400">العميل: {actionModalClient.name}</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setActionModalClient(null);
                  setActionModalType(null);
                }}
                className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-xl hover:bg-slate-200 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 text-xs space-y-1">
                <p className="font-black text-slate-500">اسم الموظف القائم بالإجراء:</p>
                <p className="font-black text-primary-600 dark:text-primary-400">{user?.name || 'موظف المبيعات'}</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Edit3 size={14} className="text-primary-500" />
                  <span>رأي وملاحظات موظف المبيعات (الكومنت المطلوب) *</span>
                </label>
                <textarea
                  rows={4}
                  value={salesCommentInput}
                  onChange={e => setSalesCommentInput(e.target.value)}
                  placeholder={
                    actionModalType === 'ACCEPT'
                      ? 'اكتب رأيك وانطباعك عن العميل والخطة المقترحة للمتابعة...'
                      : 'اكتب سبب تخطي هذا العميل (مثلاً: عدم جدية العميل، التواصل سابقاً، إلخ)...'
                  }
                  className="w-full bg-slate-50 dark:bg-slate-800 text-xs font-bold p-4 rounded-2xl border border-slate-200 dark:border-slate-700 outline-none focus:border-primary-500 dark:text-white resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setActionModalClient(null);
                  setActionModalType(null);
                }}
                className="px-5 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl text-xs font-black hover:bg-slate-200 transition"
              >
                إلغاء
              </button>

              <button
                onClick={() => handleExecuteSalesAction(actionModalClient, actionModalType, salesCommentInput)}
                className={`px-6 py-3 rounded-2xl font-black text-xs text-white transition flex items-center gap-2 shadow-lg ${
                  actionModalType === 'ACCEPT' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20' : 'bg-purple-600 hover:bg-purple-700 shadow-purple-600/20'
                }`}
              >
                <CheckCircle2 size={16} />
                <span>تأكيد وحفظ الإجراء</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* SUPERVISOR OVERRIDE MODAL */}
      {supervisorModalClient && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-7 max-w-lg w-full border border-indigo-200 dark:border-indigo-800 space-y-6 shadow-2xl relative">
            
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-black">
                  <Shield size={22} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">أمر المشرف: إعادة للمتابعة الفعالة</h3>
                  <p className="text-xs font-bold text-slate-400">العميل: {supervisorModalClient.name}</p>
                </div>
              </div>
              <button 
                onClick={() => setSupervisorModalClient(null)}
                className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-xl hover:bg-slate-200 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-black text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                  <Edit3 size={14} className="text-indigo-500" />
                  <span>توجيهات وتعليمات المشرف لمسؤول المبيعات</span>
                </label>
                <textarea
                  rows={4}
                  value={supervisorNoteInput}
                  onChange={e => setSupervisorNoteInput(e.target.value)}
                  placeholder="اكتب التعليمات الواجب على مسؤول المبيعات اتباعها عند المتابعة القادمة..."
                  className="w-full bg-slate-50 dark:bg-slate-800 text-xs font-bold p-4 rounded-2xl border border-indigo-200 dark:border-indigo-800 outline-none focus:border-indigo-500 dark:text-white resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setSupervisorModalClient(null)}
                className="px-5 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl text-xs font-black hover:bg-slate-200 transition"
              >
                إلغاء
              </button>

              <button
                onClick={() => handleSupervisorReassignToFollowup(supervisorModalClient, supervisorNoteInput)}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-xs transition flex items-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                <RotateCcw size={16} />
                <span>تنفيذ إعادة المتابعة</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ACTIVE WORKING SALES SELECTION & PER-AGENT QUOTA MODAL */}
      {showBatchConfigModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-7 max-w-2xl w-full border border-slate-200 dark:border-slate-800 space-y-6 shadow-2xl relative">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-black">
                  <SlidersHorizontal size={24} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">تحديد السيلز الشغالين وحصة التحليل اليومية</h3>
                  <p className="text-xs font-bold text-slate-400">اختر مسؤولين المبيعات النشطين اليوم وحدد حصة العملاء لكل سيلز</p>
                </div>
              </div>
              <button 
                onClick={() => setShowBatchConfigModal(false)}
                className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-xl hover:bg-slate-200 transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Quota Per Agent Input */}
            <div className="p-5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <label className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <Zap size={16} className="text-amber-500" />
                    <span>حصة العملاء لكل سيلز شغال (الحد لكل مسؤول مبيعات):</span>
                  </label>
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                    الذكاء الاصطناعي سيحلل حتى هذا العدد من العملاء المؤهلين لكل سيلز محدد
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input 
                    type="number"
                    min={1}
                    max={200}
                    value={perAgentQuota}
                    onChange={(e) => setPerAgentQuota(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-24 p-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-black text-center text-sm border border-slate-300 dark:border-slate-600 rounded-xl outline-none focus:border-amber-500"
                  />
                  <span className="text-xs font-black text-slate-500">عميل</span>
                </div>
              </div>

              {/* Preset buttons */}
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <span className="text-[11px] font-bold text-slate-400 ml-1">تحديد سريع للحصة:</span>
                {[10, 15, 20, 25, 30, 50].map(q => (
                  <button
                    key={q}
                    onClick={() => setPerAgentQuota(q)}
                    className={`px-3 py-1.5 rounded-xl font-black text-xs transition ${
                      perAgentQuota === q
                        ? 'bg-amber-500 text-white shadow-md'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-amber-500'
                    }`}
                  >
                    {q} عميل
                  </button>
                ))}
              </div>
            </div>

            {/* Active Sales Agents Selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <UserCheck size={16} className="text-primary-500" />
                  <span>السيلز الشغالين حالياً ({selectedActiveAgentIds.length} من {salesAgents.length}):</span>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedActiveAgentIds(salesAgents.map(a => a.uid))}
                    className="text-[11px] font-black text-primary-500 hover:underline"
                  >
                    تحديد الكل
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    onClick={() => setSelectedActiveAgentIds([])}
                    className="text-[11px] font-black text-rose-500 hover:underline"
                  >
                    إلغاء الكل
                  </button>
                </div>
              </div>

              {/* Grid of Agents */}
              <div className="max-h-64 overflow-y-auto pr-1 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {salesAgents.map((agent) => {
                  const isChecked = selectedActiveAgentIds.includes(agent.uid);
                  const agentClientsCount = clients.filter(c => c.salesAgentId === agent.uid && isClientInterested(c)).length;

                  return (
                    <div
                      key={agent.uid}
                      onClick={() => {
                        if (isChecked) {
                          setSelectedActiveAgentIds(selectedActiveAgentIds.filter(id => id !== agent.uid));
                        } else {
                          setSelectedActiveAgentIds([...selectedActiveAgentIds, agent.uid]);
                        }
                      }}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between select-none ${
                        isChecked 
                          ? 'bg-primary-50/70 dark:bg-primary-500/10 border-primary-500 text-slate-900 dark:text-white shadow-sm' 
                          : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-lg flex items-center justify-center border transition ${
                          isChecked ? 'bg-primary-500 border-primary-500 text-white' : 'border-slate-400 bg-white dark:bg-slate-900'
                        }`}>
                          {isChecked && <Check size={14} className="stroke-[3]" />}
                        </div>
                        <div>
                          <p className="text-xs font-black">{agent.name}</p>
                          <span className="text-[10px] font-bold text-slate-400">
                            {agent.role === UserRole.TEAM_LEADER ? 'رئيس فريق' : 'مبيعات'} • {agentClientsCount} عميل مؤهل
                          </span>
                        </div>
                      </div>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                        isChecked ? 'bg-primary-500/20 text-primary-600 dark:text-primary-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                      }`}>
                        {isChecked ? `حتى ${perAgentQuota}` : 'غير متواجد'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Total Calculation Banner */}
            <div className="p-4 bg-gradient-to-r from-primary-500/10 via-indigo-500/10 to-emerald-500/10 rounded-2xl border border-primary-500/20 flex items-center justify-between text-xs font-black">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white">
                <Sparkles size={18} className="text-amber-500" />
                <span>إجمالي دفعة اليوم المخططة:</span>
              </div>
              <span className="text-sm font-black text-primary-600 dark:text-primary-400">
                {selectedActiveAgentIds.length * perAgentQuota} عميل ({selectedActiveAgentIds.length} سيلز × {perAgentQuota})
              </span>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowBatchConfigModal(false)}
                className="px-5 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl text-xs font-black hover:bg-slate-200 transition"
              >
                حفظ وإغلاق
              </button>

              <button
                onClick={() => {
                  setShowBatchConfigModal(false);
                  handleBatchAnalyze();
                }}
                disabled={selectedActiveAgentIds.length === 0}
                className="px-6 py-3 bg-gradient-to-r from-primary-500 to-indigo-600 hover:from-primary-600 hover:to-indigo-700 text-white rounded-2xl font-black text-xs transition flex items-center gap-2 shadow-lg disabled:opacity-50"
              >
                <Zap size={16} />
                <span>بدء تشغيل الدفعة الآن ({selectedActiveAgentIds.length * perAgentQuota} عميل)</span>
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

