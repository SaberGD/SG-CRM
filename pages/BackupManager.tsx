
import React, { useState } from 'react';
import { 
  collection, getDocs, writeBatch, doc, deleteDoc, query, limit 
} from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { UserRole } from '../types';
import { 
  Download, Upload, Database, FileSpreadsheet, Archive, 
  AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert 
} from 'lucide-react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

const BackupManager: React.FC = () => {
  const { user, effectiveRole } = useAuth();
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  const isHighRole = effectiveRole === UserRole.ADMIN || effectiveRole === UserRole.MANAGER || effectiveRole === UserRole.TEAM_LEADER;
  const isAdmin = effectiveRole === UserRole.ADMIN;

  const collections = [
    'users', 'clients', 'followups', 'reports', 'logs', 
    'services', 'labels', 'invitations', 'targets', 'defaultTargets'
  ];

  const createBackup = async () => {
    if (!user || isBackingUp) return;
    setIsBackingUp(true);
    setProgress(0);
    setStatus('جاري تجميع البيانات...');

    try {
      const zip = new JSZip();
      const allData: Record<string, any[]> = {};

      for (let i = 0; i < collections.length; i++) {
        const colName = collections[i];
        setStatus(`جاري جلب بيانات: ${colName}...`);
        const snap = await getDocs(collection(db, colName));
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        allData[colName] = data;
        zip.file(`${colName}.json`, JSON.stringify(data, null, 2));
        setProgress(Math.round(((i + 1) / collections.length) * 50));
      }

      // Create Excel for Clients
      setStatus('جاري إنشاء ملف Excel للعملاء...');
      const clientsWS = XLSX.utils.json_to_sheet(allData['clients'] || []);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, clientsWS, "Clients");
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Save Excel separately
      const excelBlob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(excelBlob, `SaberCRM_Clients_Backup_${timestamp}.xlsx`);

      // Save Zip
      setStatus('جاري ضغط الملفات...');
      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, `SaberCRM_Full_System_Backup_${timestamp}.zip`);

      await logActivity(user.uid, user.name, "إنشاء نسخة احتياطية كاملة للنظام", "system", "backup");
      setStatus('تم اكتمال النسخ الاحتياطي بنجاح');
      setProgress(100);
    } catch (err) {
      console.error(err);
      setStatus('فشل النسخ الاحتياطي');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !isAdmin) return;

    const confirmRestore = window.confirm("تحذير: استعادة النظام ستقوم بإضافة البيانات من الملف. هل أنت متأكد؟ يفضل أخذ نسخة احتياطية حالية أولاً.");
    if (!confirmRestore) return;

    setIsRestoring(true);
    setProgress(0);
    setStatus('جاري قراءة ملف النسخة الاحتياطية...');

    try {
      const zip = await JSZip.loadAsync(file);
      const restoreData: Record<string, any[]> = {};

      for (const colName of collections) {
        const jsonFile = zip.file(`${colName}.json`);
        if (jsonFile) {
          const content = await jsonFile.async("string");
          restoreData[colName] = JSON.parse(content);
        }
      }

      // Restore logic: Write to Firestore
      // Note: This is a simplified restore that adds/updates documents.
      // It doesn't delete existing data unless explicitly coded.
      
      let totalDocs = 0;
      Object.values(restoreData).forEach(arr => totalDocs += arr.length);
      let processedDocs = 0;

      for (const colName of collections) {
        const data = restoreData[colName];
        if (!data) continue;

        setStatus(`جاري استعادة: ${colName}...`);
        
        // Use batches for efficiency (Firestore limit is 500 per batch)
        for (let i = 0; i < data.length; i += 500) {
          const batch = writeBatch(db);
          const chunk = data.slice(i, i + 500);
          
          chunk.forEach(item => {
            const { id, ...docData } = item;
            const docRef = doc(db, colName, id);
            batch.set(docRef, docData, { merge: true });
          });

          await batch.commit();
          processedDocs += chunk.length;
          setProgress(Math.round((processedDocs / totalDocs) * 100));
        }
      }

      await logActivity(user.uid, user.name, "استعادة النظام من نسخة احتياطية", "system", "restore");
      setStatus('تمت استعادة النظام بنجاح');
    } catch (err) {
      console.error(err);
      setStatus('فشل استعادة النظام');
    } finally {
      setIsRestoring(false);
    }
  };

  if (!isHighRole) return <div className="p-20 text-center font-black text-rose-500">غير مصرح لك بالدخول لهذه الصفحة</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-fade-in pb-20">
      <header className="text-center space-y-4">
        <div className="w-20 h-20 bg-primary-500 text-white rounded-[2rem] flex items-center justify-center mx-auto shadow-xl shadow-primary-500/20">
          <Database size={40} />
        </div>
        <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">إدارة <span className="text-primary-500">النسخ الاحتياطي</span></h1>
        <p className="text-slate-500 font-bold">تأمين بيانات النظام، التصدير، والاستعادة</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Backup Section */}
        <div className="bg-white dark:bg-slate-900 p-10 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-xl space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 dark:bg-blue-500/10 text-blue-500 rounded-2xl flex items-center justify-center">
              <Archive size={24} />
            </div>
            <h2 className="text-xl font-black">إنشاء نسخة احتياطية</h2>
          </div>
          
          <p className="text-xs font-bold text-slate-500 leading-relaxed">
            سيقوم النظام بإنشاء ملفين:
            <br />1. ملف Excel يحتوي على جميع بيانات العملاء.
            <br />2. ملف Zip يحتوي على قاعدة البيانات كاملة للاستعادة لاحقاً.
          </p>

          <button 
            onClick={createBackup}
            disabled={isBackingUp || isRestoring}
            className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:bg-primary-600 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
          >
            {isBackingUp ? <RefreshCw className="animate-spin" /> : <Download />}
            {isBackingUp ? 'جاري النسخ...' : 'بدء النسخ الاحتياطي الآن'}
          </button>
        </div>

        {/* Restore Section */}
        <div className="bg-white dark:bg-slate-900 p-10 rounded-[3rem] border border-slate-100 dark:border-slate-800 shadow-xl space-y-8 relative overflow-hidden">
          {!isAdmin && (
            <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center p-8 text-center">
              <ShieldAlert size={48} className="text-rose-500 mb-4" />
              <p className="font-black text-rose-500">خاص بمدير النظام فقط</p>
              <p className="text-[10px] font-bold text-slate-500 mt-2">الاستعادة تتطلب صلاحيات Admin كاملة</p>
            </div>
          )}
          
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-50 dark:bg-amber-500/10 text-amber-500 rounded-2xl flex items-center justify-center">
              <Upload size={24} />
            </div>
            <h2 className="text-xl font-black">استعادة النظام</h2>
          </div>

          <p className="text-xs font-bold text-slate-500 leading-relaxed">
            قم برفع ملف الـ Zip الذي تم تحميله مسبقاً لاستعادة البيانات.
            <br />
            <span className="text-rose-500 font-black">تنبيه: هذه العملية قد تؤدي لتكرار البيانات إذا كانت موجودة بالفعل.</span>
          </p>

          <label className={`w-full py-5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-3xl font-black shadow-sm flex items-center justify-center gap-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-all ${isRestoring || isBackingUp ? 'opacity-50 pointer-events-none' : ''}`}>
            {isRestoring ? <RefreshCw className="animate-spin" /> : <Upload />}
            {isRestoring ? 'جاري الاستعادة...' : 'اختيار ملف النسخة (.zip)'}
            <input type="file" accept=".zip" className="hidden" onChange={handleRestore} />
          </label>
        </div>
      </div>

      {/* Progress Indicator */}
      {(isBackingUp || isRestoring) && (
        <div className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border-2 border-primary-500 shadow-2xl space-y-4 animate-bounce">
          <div className="flex justify-between items-center">
            <span className="text-xs font-black text-primary-500 uppercase tracking-widest">{status}</span>
            <span className="text-lg font-black">{progress}%</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-4 rounded-full overflow-hidden p-1">
            <div className="bg-primary-500 h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
      )}

      {/* Success Message */}
      {status.includes('بنجاح') && !isBackingUp && !isRestoring && (
        <div className="bg-emerald-500 text-white p-6 rounded-[2rem] flex items-center gap-4 shadow-xl animate-fade-in">
          <CheckCircle2 size={32} />
          <div>
            <p className="font-black">عملية ناجحة</p>
            <p className="text-xs font-bold opacity-90">{status}</p>
          </div>
        </div>
      )}

      {/* Warning Box */}
      <div className="bg-amber-50 dark:bg-amber-500/5 p-8 rounded-[2.5rem] border border-amber-200 dark:border-amber-500/20 flex gap-6">
        <AlertTriangle size={40} className="text-amber-500 shrink-0" />
        <div className="space-y-2">
          <h3 className="font-black text-amber-700 dark:text-amber-500">تعليمات هامة</h3>
          <ul className="text-xs font-bold text-amber-600/80 space-y-1 list-disc list-inside">
            <li>ينصح بعمل نسخة احتياطية يومياً قبل نهاية الدوام.</li>
            <li>ملف الـ Excel مخصص للعرض والتحليل الخارجي فقط.</li>
            <li>ملف الـ Zip هو الملف الوحيد الذي يمكن استخدامه لاستعادة النظام.</li>
            <li>لا تقم بتعديل محتوى ملف الـ Zip يدوياً لتجنب فشل الاستعادة.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default BackupManager;
