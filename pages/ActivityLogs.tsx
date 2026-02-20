
import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { ActivityLog } from '../types';
import { Clock, User, UserPlus, Edit3, PhoneIncoming } from 'lucide-react';

const ActivityLogs: React.FC = () => {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'logs'), orderBy('timestamp', 'desc'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActivityLog)));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const getIcon = (action: string) => {
    if (action.includes("إضافة")) return <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500 rounded-2xl"><UserPlus size={20} /></div>;
    if (action.includes("تعديل")) return <div className="p-3 bg-amber-50 dark:bg-amber-500/10 text-amber-500 rounded-2xl"><Edit3 size={20} /></div>;
    return <div className="p-3 bg-primary-50 dark:bg-primary-500/10 text-primary-500 rounded-2xl"><PhoneIncoming size={20} /></div>;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <header>
        <h1 className="text-4xl font-black text-slate-900 dark:text-white no-tracking">سجل النشاطات</h1>
        <p className="text-slate-500 dark:text-slate-400 font-bold mt-1 no-tracking">مراقبة العمليات والتحركات في النظام</p>
      </header>

      <div className="bg-white dark:bg-slate-900 rounded-4xl shadow-xl shadow-slate-200/40 dark:shadow-none border border-slate-100 dark:border-slate-800 overflow-hidden">
        {loading ? (
          <div className="text-center py-20 animate-pulse font-black text-slate-400">جاري تحميل السجلات...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-20 text-slate-400 font-bold">لا توجد سجلات بعد</div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-800">
            {logs.map((log) => (
              <div key={log.id} className="p-6 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex items-center gap-5">
                {getIcon(log.action)}
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <p className="text-sm font-bold text-slate-900 dark:text-white no-tracking">
                      قام <span className="text-primary-500 font-black">{log.userName}</span>
                      {" "}{log.action}{" "}
                      للعميل <span className="font-black underline">{log.targetName}</span>
                    </p>
                    <span className="text-[10px] font-black bg-slate-100 dark:bg-slate-800 text-slate-400 px-3 py-1.5 rounded-full flex items-center">
                      <Clock size={12} className="ml-1" />
                      {new Date(log.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-4">
                    <span className="text-[10px] font-black uppercase text-slate-400 flex items-center tracking-widest">
                      <User size={10} className="ml-1" /> Agent ID: {log.userId.slice(-6)}
                    </span>
                    <span className="text-[10px] font-black uppercase text-slate-400 flex items-center tracking-widest">
                      Date: {new Date(log.timestamp).toLocaleDateString('ar-EG')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActivityLogs;
