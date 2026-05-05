
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, doc, deleteDoc } from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { Label } from '../types';
import { Plus, Trash2, Tag, X, AlertTriangle, ShieldAlert } from 'lucide-react';
import FloatingPanel from '../components/FloatingPanel';

const COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-rose-500', 'bg-amber-500', 
  'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-slate-500'
];

const LabelsManager: React.FC = () => {
  const { user } = useAuth();
  const [labels, setLabels] = useState<Label[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ text: '', color: COLORS[0] });
  
  // Deletion States
  const [labelToDelete, setLabelToDelete] = useState<Label | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'labels'), snap => {
      setLabels(snap.docs.map(d => ({ id: d.id, ...d.data() } as Label)));
    }, (err) => {
      console.error("LabelsManager Snapshot Error:", err);
    });
    return unsub;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.text.trim()) return;
    try {
      await addDoc(collection(db, 'labels'), formData);
      setIsModalOpen(false);
      setFormData({ text: '', color: COLORS[0] });
    } catch (err) { console.error(err); }
  };

  const confirmDelete = async () => {
    if (!labelToDelete || deleteConfirmText !== 'delete' || !user) return;
    
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'labels', labelToDelete.id));
      await logActivity(user.uid, user.name, `حذف تصنيف [${labelToDelete.text}] نهائياً`, labelToDelete.id, labelToDelete.text);
      setLabelToDelete(null);
      setDeleteConfirmText('');
    } catch (err) {
      console.error("Error deleting label:", err);
      alert("حدث خطأ أثناء محاولة الحذف");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-10 animate-fade-in pb-20 text-right">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">إدارة <span className="text-primary-500">التصنيفات</span></h1>
          <p className="text-slate-500 font-bold mt-1">تصنيف العملاء لتسهيل الوصول والبحث والفلترة</p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="bg-primary-500 text-white px-8 py-4 rounded-3xl font-black text-xs uppercase shadow-xl hover:bg-primary-600 transition-all flex items-center gap-2">
          <Plus size={18} /> إضافة تصنيف جديد
        </button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
        {labels.map(label => (
          <div key={label.id} className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col items-center gap-4 relative group hover:border-primary-500/30 transition-all">
            <button 
              onClick={() => { setLabelToDelete(label); setDeleteConfirmText(''); }} 
              className="absolute top-4 left-4 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl"
            >
              <Trash2 size={16}/>
            </button>
            <div className={`w-14 h-14 rounded-[1.5rem] flex items-center justify-center text-white shadow-lg ${label.color} group-hover:scale-110 transition-transform`}>
              <Tag size={24}/>
            </div>
            <span className="text-xs font-black uppercase tracking-widest text-center">{label.text}</span>
          </div>
        ))}
        {labels.length === 0 && (
          <div className="col-span-full py-20 text-center text-slate-400 font-bold italic border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-[3rem]">
            لا توجد تصنيفات مضافة حالياً
          </div>
        )}
      </div>

      <FloatingPanel 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title="تصنيف جديد"
        icon={<Plus className="text-primary-500" />}
      >
            <form onSubmit={handleSubmit} className="space-y-8 pt-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400 mr-2 block">نص التصنيف</label>
                <input required placeholder="مثال: عميل VIP..." className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold text-slate-900 dark:text-white border border-transparent focus:border-primary-500" value={formData.text} onChange={e => setFormData({...formData, text: e.target.value})} />
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-black uppercase text-slate-400 mr-2 block">اختر لون التصنيف:</label>
                <div className="grid grid-cols-4 gap-3">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setFormData({...formData, color: c})} className={`w-12 h-12 rounded-xl transition-all ${c} ${formData.color === c ? 'scale-110 ring-4 ring-primary-500/20 shadow-lg' : 'opacity-40 hover:opacity-100'}`}></button>
                  ))}
                </div>
              </div>
              <button type="submit" className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:bg-primary-600 transition-all uppercase tracking-widest text-xs active:scale-[0.98]">
                إضافة التصنيف الآن
              </button>
            </form>
      </FloatingPanel>

      <FloatingPanel 
        isOpen={!!labelToDelete} 
        onClose={() => { setLabelToDelete(null); setDeleteConfirmText(''); }} 
        title="تأكيد الحذف"
        icon={<ShieldAlert className="text-rose-500" />}
      >
            {labelToDelete && (
              <div className="space-y-8 pt-2">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="w-20 h-20 bg-rose-50 dark:bg-rose-500/10 text-rose-500 rounded-3xl flex items-center justify-center shadow-inner">
                    <Trash2 size={40} className="animate-pulse" />
                  </div>
                  <p className="text-sm font-bold text-slate-500 leading-relaxed px-4">
                    أنت على وشك حذف التصنيف <span className="text-rose-500 font-black">[{labelToDelete.text}]</span>. سيتم إزالته من كافة العملاء المرتبطين به.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-rose-500 text-center block">اكتب كلمة <span className="underline font-black">delete</span> للتأكيد</label>
                    <input 
                      type="text" 
                      autoFocus
                      className="w-full p-5 bg-rose-50/50 dark:bg-rose-500/5 rounded-2xl outline-none font-black text-center border-2 border-rose-100 dark:border-rose-500/20 focus:border-rose-500 text-rose-600"
                      placeholder="delete"
                      value={deleteConfirmText}
                      onChange={e => setDeleteConfirmText(e.target.value.toLowerCase())}
                    />
                  </div>

                  <div className="flex gap-4">
                    <button 
                      onClick={confirmDelete}
                      disabled={deleteConfirmText !== 'delete' || isDeleting}
                      className="flex-1 py-5 bg-rose-500 text-white rounded-3xl font-black shadow-xl shadow-rose-500/20 hover:bg-rose-600 transition-all disabled:opacity-50 disabled:grayscale uppercase text-[10px] tracking-widest active:scale-[0.98]"
                    >
                      {isDeleting ? 'جاري الحذف...' : 'حذف الآن'}
                    </button>
                    <button 
                      onClick={() => { setLabelToDelete(null); setDeleteConfirmText(''); }} 
                      className="px-8 py-5 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-3xl font-black text-[10px] uppercase hover:bg-slate-200 transition-all"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              </div>
            )}
      </FloatingPanel>
    </div>
  );
};

export default LabelsManager;
