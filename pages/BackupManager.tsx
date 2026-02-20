
import React, { useState } from 'react';
import { collection, getDocs, addDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../App';
import { Database, Download, Upload, ShieldAlert, History } from 'lucide-react';

const BackupManager: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const collections = ['users', 'clients', 'followups', 'reports', 'logs'];

  const handleExport = async () => {
    setLoading(true);
    setStatus('جاري تجميع البيانات...');
    try {
      const backupData: any = {};
      for (const colName of collections) {
        const snap = await getDocs(collection(db, colName));
        backupData[colName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `SaberGroup_Backup_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      setStatus('تم التصدير بنجاح');
    } catch (err) {
      setStatus('فشل التصدير');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !window.confirm("تحذير: هذا سيقوم بإضافة البيانات المستوردة إلى النظام الحالي. هل أنت متأكد؟")) return;
    
    setLoading(true);
    setStatus('جاري استيراد البيانات...');
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        for (const colName of collections) {
          if (data[colName]) {
            for (const item of data[colName]) {
              const { id, ...cleanItem } = item;
              await addDoc(collection(db, colName), cleanItem);
            }
          }
        }
        setStatus('تم الاستيراد بنجاح');
      } catch (err) {
        setStatus('فشل الاستيراد: ملف غير صالح');
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  };

  if (user?.role !== 'admin' && user?.role !== 'manager') return <div className="text-center py-20 font-black">غير مصرح لك بدخول هذه الصفحة</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-12">
      <header>
        <h1 className="text-4xl font-black text-slate-900 dark:text-white">إدارة النسخ الاحتياطي</h1>
        <p className="text-slate-500 font-bold mt-1">تأمين بيانات النظام واستعادتها عند الضرورة</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-slate-900 p-10 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-xl shadow-slate-200/40 text-center space-y-6">
          <div className="w-20 h-20 bg-primary-500 text-white rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-primary-500/20"><Download size={32}/></div>
          <h3 className="text-2xl font-black">تصدير كامل</h3>
          <p className="text-sm font-bold text-slate-400">تحميل كافة بيانات العملاء والمتابعات والتقارير في ملف JSON واحد.</p>
          <button 
            onClick={handleExport}
            disabled={loading}
            className="w-full py-5 bg-primary-500 text-white rounded-[2rem] font-black text-sm uppercase tracking-widest hover:scale-[1.02] transition-transform disabled:opacity-50"
          >
            تصدير الآن
          </button>
        </div>

        <div className="bg-white dark:bg-slate-900 p-10 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-xl shadow-slate-200/40 text-center space-y-6">
          <div className="w-20 h-20 bg-emerald-500 text-white rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/20"><Upload size={32}/></div>
          <h3 className="text-2xl font-black">استيراد بيانات</h3>
          <p className="text-sm font-bold text-slate-400">رفع ملف نسخة احتياطية سابق لدمج البيانات في النظام الحالي.</p>
          <label className="block w-full py-5 bg-emerald-500 text-white rounded-[2rem] font-black text-sm uppercase tracking-widest hover:scale-[1.02] transition-transform cursor-pointer text-center">
            اختيار ملف واستيراد
            <input type="file" className="hidden" accept=".json" onChange={handleImport} disabled={loading} />
          </label>
        </div>
      </div>

      {status && (
        <div className={`p-6 rounded-3xl text-center font-black ${status.includes('فشل') ? 'bg-rose-50 text-rose-500' : 'bg-emerald-50 text-emerald-500'} animate-fade-in`}>
          {status}
        </div>
      )}

      <div className="bg-rose-50 dark:bg-rose-500/5 border border-rose-100 dark:border-rose-500/10 p-8 rounded-[3rem] flex items-start gap-6">
        <div className="p-3 bg-rose-500 text-white rounded-2xl shadow-lg shadow-rose-500/20"><ShieldAlert size={24}/></div>
        <div>
          <h4 className="text-lg font-black text-rose-600 mb-2">تعليمات هامة</h4>
          <p className="text-sm font-bold text-rose-600/80 leading-relaxed">
            تذكر دائماً إجراء نسخة احتياطية أسبوعية على الأقل. ملفات النسخ الاحتياطي تحتوي على معلومات حساسة، تأكد من تخزينها في مكان آمن ومشفر. عملية الاستيراد لا تحذف البيانات الحالية بل تضيف إليها.
          </p>
        </div>
      </div>
    </div>
  );
};

export default BackupManager;
