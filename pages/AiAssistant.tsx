import React, { useState, useEffect } from 'react';
import * as firestore from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { Client, UserRole, User, ClientStatus, CommMethod, AiRecommendation, FollowUp } from '../types';
import { analyzeClientWithAi } from '../geminiService';
import { 
  Bot, Sparkles, Calendar, Phone, CheckCircle2, AlertTriangle, 
  RefreshCw, Filter, Copy, Check, XCircle, ArrowRight, UserCheck, 
  MessageSquare, TrendingUp, Shield, Zap
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const AiAssistant: React.FC = () => {
  const { user, effectiveRole } = useAuth();
  const navigate = useNavigate();

  const [clients, setClients] = useState<Client[]>([]);
  const [salesAgents, setSalesAgents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('pending'); // 'pending' | 'accepted' | 'all'
  const [searchQuery, setSearchQuery] = useState('');

  // Batch Processing State
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);

  // Single Analysis Loading State
  const [analyzingClientId, setAnalyzingClientId] = useState<string | null>(null);

  // Copy feedback state
  const [copiedClientId, setCopiedClientId] = useState<string | null>(null);

  const isHighRole = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER || effectiveRole === UserRole.TEAM_LEADER;

  // Fetch Clients and Sales Agents
  useEffect(() => {
    if (!user) return;

    // Fetch Agents list for managers
    const fetchAgents = async () => {
      try {
        const usersSnap = await firestore.getDocs(firestore.collection(db, 'users'));
        const agentsList = usersSnap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as User));
        setSalesAgents(agentsList);
      } catch (err) {
        console.error("Error fetching sales agents:", err);
      }
    };
    fetchAgents();

    // Fetch Clients
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

  // Handle single client analysis
  const handleAnalyzeClient = async (client: Client) => {
    setAnalyzingClientId(client.id);
    try {
      // Fetch client follow-ups for contextual history
      const followUpsSnap = await firestore.getDocs(
        firestore.query(
          firestore.collection(db, 'followUps'),
          firestore.where('clientId', '==', client.id)
        )
      );
      const followUps = followUpsSnap.docs.map(d => d.data() as FollowUp);

      const result = await analyzeClientWithAi(client, followUps);

      // Parse date to timestamp
      const [year, month, day] = (result.suggestedDate || '').split('-').map(Number);
      let suggestedTimestamp = Date.now() + 86400000; // default +24h
      if (year && month && day) {
        const [hours, minutes] = (result.suggestedTime || '12:00').split(':').map(Number);
        suggestedTimestamp = new Date(year, month - 1, day, hours || 12, minutes || 0).getTime();
      }

      const newRecommendation: AiRecommendation = {
        suggestedDate: result.suggestedDate || new Date(suggestedTimestamp).toISOString().split('T')[0],
        suggestedTime: result.suggestedTime || '12:00',
        suggestedTimestamp,
        suggestedChannel: result.suggestedChannel || 'واتساب',
        suggestedPitch: result.suggestedPitch || 'مرحباً، أود متابعة استفسارك بشأن الدورة التدريبية...',
        conversionPriority: (result.conversionPriority as any) || 'متوسط',
        insightsSummary: result.insightsSummary || 'تحليل ذكي بناءً على حالة العميل وسجلات المتابعة.',
        salesTip: result.salesTip || 'ركز على توضيح المزايا والخصم المتاح للعميل.',
        generatedAt: Date.now(),
        status: 'PENDING'
      };

      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), {
        aiRecommendation: newRecommendation
      });

    } catch (err: any) {
      console.error("Error analyzing client:", err);
      alert(`حدث خطأ أثناء التحليل بالذكاء الاصطناعي: ${err?.message || ''}`);
    } finally {
      setAnalyzingClientId(null);
    }
  };

  // Run Batch Analysis for clients needing AI recommendation
  const handleBatchAnalyze = async () => {
    const unanalyzedClients = clients.filter(c => !c.aiRecommendation || c.aiRecommendation.status === 'PENDING').slice(0, 10);
    
    if (unanalyzedClients.length === 0) {
      alert("جميع العملاء المحددين لديهم توصيات ذكاء اصطناعي محدثة بالفعل.");
      return;
    }

    setIsBatchAnalyzing(true);
    setBatchProgress(0);

    for (let i = 0; i < unanalyzedClients.length; i++) {
      const c = unanalyzedClients[i];
      try {
        await handleAnalyzeClient(c);
      } catch (e) {
        console.warn(`Failed to batch analyze client ${c.name}`, e);
      }
      setBatchProgress(Math.round(((i + 1) / unanalyzedClients.length) * 100));
    }

    setIsBatchAnalyzing(false);
  };

  // Convert AI Recommendation into a real Scheduled Follow-up
  const handleApplyRecommendation = async (client: Client) => {
    if (!client.aiRecommendation) return;

    try {
      const rec = client.aiRecommendation;
      
      // Determine CommMethod
      let method: CommMethod = CommMethod.WHATSAPP;
      if (rec.suggestedChannel.includes('اتصال') || rec.suggestedChannel.includes('هاتف')) {
        method = CommMethod.PHONE;
      } else if (rec.suggestedChannel.includes('مقابلة') || rec.suggestedChannel.includes('مقر')) {
        method = CommMethod.MEETING;
      }

      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), {
        nextFollowUpDate: rec.suggestedTimestamp,
        nextFollowUpMethod: method,
        notes: client.notes ? `${client.notes}\n[توصية AI]: ${rec.suggestedPitch}` : `[توصية AI]: ${rec.suggestedPitch}`,
        'aiRecommendation.status': 'ACCEPTED',
        'aiRecommendation.acceptedAt': Date.now(),
        'aiRecommendation.acceptedByUid': user?.uid,
        'aiRecommendation.acceptedByName': user?.name
      });

      await logActivity(
        user?.uid || '',
        user?.name || 'موظف',
        `اعتماد توصية المساعد الذكي AI لمتابعة العميل`,
        client.id,
        client.name
      );

      alert(`تم اعتماد اقتراح الذكاء الاصطناعي بنجاح وجدولة المتابعة بتاريخ ${rec.suggestedDate}`);

    } catch (err: any) {
      console.error("Error applying recommendation:", err);
      alert("حدث خطأ أثناء حفظ التوصية كمتابعة حقيقية.");
    }
  };

  // Dismiss AI Recommendation
  const handleDismissRecommendation = async (client: Client) => {
    try {
      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), {
        'aiRecommendation.status': 'DISMISSED'
      });
    } catch (err) {
      console.error("Error dismissing recommendation:", err);
    }
  };

  const copyPitchToClipboard = (clientId: string, pitch: string) => {
    navigator.clipboard.writeText(pitch);
    setCopiedClientId(clientId);
    setTimeout(() => setCopiedClientId(null), 2000);
  };

  // Filtering
  const filteredClients = clients.filter(c => {
    // Search
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone.includes(searchQuery);
    if (!matchesSearch) return false;

    // Status Filter
    if (statusFilter === 'pending') {
      if (!c.aiRecommendation || c.aiRecommendation.status !== 'PENDING') return false;
    } else if (statusFilter === 'accepted') {
      if (!c.aiRecommendation || c.aiRecommendation.status !== 'ACCEPTED') return false;
    } else if (statusFilter === 'has_ai') {
      if (!c.aiRecommendation) return false;
    }

    // Priority Filter
    if (priorityFilter !== 'all') {
      if (c.aiRecommendation?.conversionPriority !== priorityFilter) return false;
    }

    return true;
  });

  // Calculate Metrics
  const totalAnalyzed = clients.filter(c => !!c.aiRecommendation).length;
  const totalAccepted = clients.filter(c => c.aiRecommendation?.status === 'ACCEPTED').length;
  const highPriorityCount = clients.filter(c => c.aiRecommendation?.conversionPriority === 'عالي' && c.aiRecommendation?.status === 'PENDING').length;
  const adoptionRate = totalAnalyzed > 0 ? Math.round((totalAccepted / totalAnalyzed) * 100) : 0;

  return (
    <div className="space-y-8 dir-rtl">
      
      {/* Top Banner Header */}
      <div className="bg-gradient-to-l from-slate-900 via-indigo-950 to-slate-900 rounded-[3rem] p-8 lg:p-12 text-white shadow-2xl relative overflow-hidden border border-slate-800">
        <div className="absolute top-0 left-0 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl -ml-20 -mt-20 pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500/20 text-primary-300 rounded-2xl border border-primary-500/30 text-xs font-black">
              <Sparkles size={16} className="text-primary-400 animate-pulse" />
              <span>مساعد المبيعات الذكي powered by Gemini 3.5</span>
            </div>
            <h1 className="text-3xl lg:text-4xl font-black tracking-tight">تحليل العملاء والتوصيات الذكية</h1>
            <p className="text-slate-300 text-xs lg:text-sm font-bold max-w-2xl leading-relaxed">
              يقوم الذكاء الاصطناعي بفحص تاريخ تواصل كل عميل، واقتراح أفضل مواعيد المتابعة القادمة، وقناة التواصل المناسبة، مع صياغة سيناريو إقناع مخصص.
            </p>
          </div>

          <button
            onClick={handleBatchAnalyze}
            disabled={isBatchAnalyzing}
            className="px-8 py-4 bg-gradient-to-r from-primary-500 to-indigo-600 hover:from-primary-600 hover:to-indigo-700 text-white font-black text-xs uppercase rounded-3xl shadow-xl transition-all flex items-center gap-3 shrink-0 disabled:opacity-50"
          >
            {isBatchAnalyzing ? (
              <>
                <RefreshCw className="animate-spin" size={18} />
                <span>جاري تحليل العملاء ({batchProgress}%)...</span>
              </>
            ) : (
              <>
                <Zap size={18} />
                <span>تحليل دفعة عملاء بالـ AI</span>
              </>
            )}
          </button>
        </div>
      </div>

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
          <div className="w-14 h-14 bg-rose-50 dark:bg-rose-500/10 text-rose-600 rounded-2xl flex items-center justify-center shrink-0">
            <AlertTriangle size={28} />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase">فرص عالية الأولوية</p>
            <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">{highPriorityCount}</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
            <CheckCircle2 size={28} />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase">المُحول لمتابعات فعلية</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{totalAccepted}</p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 bg-amber-50 dark:bg-amber-500/10 text-amber-600 rounded-2xl flex items-center justify-center shrink-0">
            <TrendingUp size={28} />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase">معدل التجاوب مع الـ AI</p>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{adoptionRate}%</p>
          </div>
        </div>

      </div>

      {/* Filter Controls Bar */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4">
          
          {/* Search Box */}
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
            {/* Sales Agent Filter for Managers/Admins */}
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

            {/* Status Filter */}
            <div className="flex items-center bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs font-black">
              <button
                onClick={() => setStatusFilter('pending')}
                className={`px-4 py-2.5 rounded-xl transition ${statusFilter === 'pending' ? 'bg-primary-500 text-white shadow' : 'text-slate-500'}`}
              >
                توصيات جديدة
              </button>
              <button
                onClick={() => setStatusFilter('accepted')}
                className={`px-4 py-2.5 rounded-xl transition ${statusFilter === 'accepted' ? 'bg-primary-500 text-white shadow' : 'text-slate-500'}`}
              >
                تم اعتمادها
              </button>
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-4 py-2.5 rounded-xl transition ${statusFilter === 'all' ? 'bg-primary-500 text-white shadow' : 'text-slate-500'}`}
              >
                الكل
              </button>
            </div>

            {/* Priority Filter */}
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

      {/* Main AI Recommendations List */}
      {loading ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-[3rem] space-y-4">
          <RefreshCw className="animate-spin text-primary-500 mx-auto" size={36} />
          <p className="text-xs font-black text-slate-500">جاري جلب توصيات المساعد الذكي...</p>
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-[3rem] space-y-4 border border-slate-100 dark:border-slate-800">
          <Bot size={48} className="text-slate-300 mx-auto" />
          <h3 className="text-base font-black text-slate-700 dark:text-slate-200">لا توجد توصيات مطابقة للفلاتر</h3>
          <p className="text-xs text-slate-400 font-bold max-w-sm mx-auto">
            يمكنك الضغط على "تحليل دفعة عملاء بالـ AI" أعلاه ليقوم الذكاء الاصطناعي بتنفيذ تحليل تلقائي لعملائك.
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
                  rec?.conversionPriority === 'عالي' && rec?.status === 'PENDING'
                    ? 'border-rose-200 dark:border-rose-900/50 bg-rose-50/20 dark:bg-rose-950/10'
                    : rec?.status === 'ACCEPTED'
                    ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/10'
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
                          {client.bookedCourseName || client.serviceName || 'دورة'}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-400 mt-1" dir="ltr">{client.phone}</p>
                    </div>

                    {/* Priority Badge */}
                    {rec ? (
                      <span className={`px-3 py-1.5 rounded-xl text-[10px] font-black flex items-center gap-1 shrink-0 ${
                        rec.conversionPriority === 'عالي'
                          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                          : rec.conversionPriority === 'متوسط'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                          : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                      }`}>
                        <Sparkles size={12} /> أولوية {rec.conversionPriority}
                      </span>
                    ) : (
                      <span className="text-[10px] font-black px-3 py-1 bg-slate-100 text-slate-500 rounded-xl">لم يحلل بعد</span>
                    )}
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
                      
                      {/* Proposed Time & Channel */}
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

                      {/* AI Reasoning / Insights */}
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-slate-400 uppercase">تحليل سلوك العميل:</p>
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300 leading-relaxed">{rec.insightsSummary}</p>
                      </div>

                      {/* Suggested Pitch Script */}
                      <div className="space-y-1 bg-primary-500/5 p-4 rounded-2xl border border-primary-500/10 relative">
                        <div className="flex justify-between items-center mb-1">
                          <p className="text-[10px] font-black text-primary-600 dark:text-primary-400 flex items-center gap-1">
                            <Sparkles size={12} /> سيناريو الإقناع المقترح:
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

                      {/* Golden Sales Tip */}
                      {rec.salesTip && (
                        <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 p-3 rounded-xl border border-amber-500/20">
                          💡 <strong>نصيحة مبيعات:</strong> {rec.salesTip}
                        </p>
                      )}

                      {/* Status Acceptance Badge */}
                      {rec.status === 'ACCEPTED' && (
                        <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-black flex items-center gap-2">
                          <CheckCircle2 size={16} />
                          <span>تم اعتماد المتابعة بواسطة {rec.acceptedByName || 'الموظف'}</span>
                        </div>
                      )}

                    </div>
                  ) : (
                    <div className="p-6 text-center bg-slate-50 dark:bg-slate-800 rounded-3xl space-y-2">
                      <p className="text-xs font-bold text-slate-500">لم يتم جلب تحليل AI بعد لهذا العميل.</p>
                      <button
                        onClick={() => handleAnalyzeClient(client)}
                        disabled={isAnalyzingThis}
                        className="px-4 py-2 bg-primary-500 text-white rounded-xl text-xs font-black hover:bg-primary-600 transition"
                      >
                        {isAnalyzingThis ? 'جاري التحليل...' : 'تشغيل التحليل الآن'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Footer Action Buttons */}
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap justify-between items-center gap-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAnalyzeClient(client)}
                      disabled={isAnalyzingThis}
                      className="p-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 rounded-2xl text-xs font-black transition flex items-center gap-1"
                      title="إعادة تحليل العميل"
                    >
                      <RefreshCw size={14} className={isAnalyzingThis ? 'animate-spin' : ''} />
                    </button>

                    {rec && rec.status === 'PENDING' && (
                      <button
                        onClick={() => handleDismissRecommendation(client)}
                        className="p-3 bg-rose-50 text-rose-600 dark:bg-rose-500/10 rounded-2xl text-xs font-black hover:bg-rose-100 transition"
                        title="تجاهل التوصية"
                      >
                        <XCircle size={16} />
                      </button>
                    )}
                  </div>

                  {rec && rec.status === 'PENDING' && (
                    <button
                      onClick={() => handleApplyRecommendation(client)}
                      className="px-6 py-3.5 bg-emerald-600 text-white rounded-2xl font-black text-xs hover:bg-emerald-700 transition flex items-center gap-2 shadow-lg shadow-emerald-600/20"
                    >
                      <CheckCircle2 size={16} />
                      <span>اعتماد وتحويل لمتابعة حقيقية</span>
                    </button>
                  )}

                  {rec && rec.status === 'ACCEPTED' && (
                    <button
                      onClick={() => navigate(`/clients/${client.id}`)}
                      className="px-6 py-3 bg-primary-500 text-white rounded-2xl font-black text-xs hover:bg-primary-600 transition flex items-center gap-2"
                    >
                      <span>عرض تفاصيل العميل</span>
                      <ArrowRight size={14} />
                    </button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
