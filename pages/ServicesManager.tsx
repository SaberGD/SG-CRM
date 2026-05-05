
import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Service } from '../types';
import { Plus, Edit3, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import FloatingPanel from '../components/FloatingPanel';
import { useAuth } from '../App';

const ServicesManager: React.FC = () => {
  const { user, effectiveRole } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '', category: '', isActive: true });

  useEffect(() => {
    if (!user || !effectiveRole) return;
    const unsub = onSnapshot(collection(db, 'services'), snap => {
      setServices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Service)));
    }, (err) => {
      console.error("ServicesManager Snapshot Error:", err);
    });
    return unsub;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingService) {
        await updateDoc(doc(db, 'services', editingService.id), formData);
      } else {
        await addDoc(collection(db, 'services'), formData);
      }
      setIsModalOpen(false);
      setEditingService(null);
      setFormData({ name: '', description: '', category: '', isActive: true });
    } catch (err) { console.error(err); }
  };

  return (
    <div className="space-y-10">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">إدارة الخدمات</h1>
          <p className="text-slate-500 font-bold mt-1">إضافة وتعديل الكورسات والمسارات التعليمية</p>
        </div>
        <button onClick={() => { setEditingService(null); setFormData({name:'', description:'', category:'', isActive:true}); setIsModalOpen(true); }} className="bg-primary-500 text-white px-8 py-4 rounded-3xl font-black text-xs uppercase shadow-xl hover:bg-primary-600 transition-all">إضافة خدمة جديدة</button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map(service => (
          <div key={service.id} className="bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex justify-between items-start">
              <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase ${service.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                {service.isActive ? 'نشط' : 'متوقف'}
              </span>
              <div className="flex gap-2">
                <button onClick={() => { setEditingService(service); setFormData(service); setIsModalOpen(true); }} className="text-slate-400 hover:text-primary-500"><Edit3 size={18}/></button>
                <button onClick={async () => { 
                  if(confirm(`هل أنت متأكد من حذف الخدمة [${service.name}] نهائياً؟`)) {
                    try {
                      await deleteDoc(doc(db, 'services', service.id));
                      alert("تم حذف الخدمة بنجاح");
                    } catch (error) {
                      console.error("Error deleting service:", error);
                      alert("حدث خطأ أثناء الحذف");
                    }
                  }
                }} className="text-slate-400 hover:text-rose-500"><Trash2 size={18}/></button>
              </div>
            </div>
            <h3 className="text-xl font-black text-slate-900 dark:text-white">{service.name}</h3>
            <p className="text-xs text-slate-500 font-bold leading-relaxed">{service.description}</p>
            <div className="pt-4 border-t border-slate-50 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase text-slate-400">التصنيف: {service.category}</span>
            </div>
          </div>
        ))}
      </div>

      <FloatingPanel 
        isOpen={isModalOpen} 
        onClose={() => { setIsModalOpen(false); setEditingService(null); }} 
        title={editingService ? 'تعديل خدمة' : 'إضافة خدمة جديدة'}
        icon={editingService ? <Edit3 className="text-primary-500" /> : <Plus className="text-primary-500" />}
      >
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              <input required placeholder="اسم الخدمة / الكورس" className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold text-slate-900 dark:text-white border border-transparent focus:border-primary-500" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              <input required placeholder="التصنيف (مثال: لغات، برمجة...)" className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold text-slate-900 dark:text-white border border-transparent focus:border-primary-500" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} />
              <textarea placeholder="وصف الخدمة..." className="w-full p-5 bg-slate-50 dark:bg-slate-800 rounded-2xl outline-none font-bold h-32 text-slate-900 dark:text-white border border-transparent focus:border-primary-500" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
              <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
                <label className="text-xs font-black text-slate-400 uppercase">حالة الخدمة:</label>
                <button type="button" onClick={() => setFormData({...formData, isActive: !formData.isActive})} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black ${formData.isActive ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white shadow-lg'}`}>
                  {formData.isActive ? <CheckCircle2 size={14}/> : <XCircle size={14}/>} {formData.isActive ? 'نشطة' : 'متوقفة'}
                </button>
              </div>
              <button type="submit" className="w-full py-5 bg-primary-500 text-white rounded-3xl font-black shadow-xl hover:bg-primary-600 transition-all active:scale-[0.98]">حفظ وتأكيد</button>
            </form>
      </FloatingPanel>
    </div>
  );
};

export default ServicesManager;
