import React, { useState } from 'react';
import * as firestore from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { useAuth } from '../App';
import { Client, ClientSource, SourceLabels, CommMethodLabels } from '../types';
import { CheckCircle2, Edit2, XCircle, Sparkles, X, CalendarClock } from 'lucide-react';

interface Props {
  client: Client;
  onClose: () => void;
  onDone: (updated: Client) => void;
}

function needsClientAccept(c: Client) {
  return c.createdVia === 'ai_automation' && !c.reviewedBySales;
}
function needsFollowUpAccept(c: Client) {
  return c.nextFollowUpSetVia === 'ai_automation' && !c.nextFollowUpReviewedBySales && !!c.nextFollowUpDate;
}

const AcceptFlowModal: React.FC<Props> = ({ client, onClose, onDone }) => {
  const { user } = useAuth();
  const [working, setWorking] = useState(client);
  const [phase, setPhase] = useState<'client' | 'followup' | null>(
    needsClientAccept(client) ? 'client' : needsFollowUpAccept(client) ? 'followup' : null
  );
  const [saving, setSaving] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState(false);
  const [fuDate, setFuDate] = useState(() => working.nextFollowUpDate ? new Date(working.nextFollowUpDate).toISOString().slice(0, 16) : '');

  const [form, setForm] = useState({
    name: client.name,
    phone: client.phone,
    profileLink: client.profileLink || '',
    distinctiveSearchPhrase: client.distinctiveSearchPhrase || '',
    source: client.source || ClientSource.OTHER,
  });

  if (!phase) {
    onDone(working);
    return null;
  }

  const advanceOrFinish = (updated: Client) => {
    setWorking(updated);
    if (needsFollowUpAccept(updated) && phase !== 'followup') {
      setPhase('followup');
    } else {
      onDone(updated);
    }
  };

  const handleAcceptClient = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const reviewedAt = Date.now();
      const updateData = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        profileLink: form.profileLink.trim(),
        distinctiveSearchPhrase: form.distinctiveSearchPhrase.trim(),
        source: form.source,
        reviewedBySales: true,
        reviewedByName: user.name,
        reviewedAt,
      };
      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), updateData);
      await logActivity(user.uid, user.name, `قبول بيانات عميل مسجّل تلقائيًا (AI Generated)`, client.id, form.name.trim());
      advanceOrFinish({ ...working, ...updateData });
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleFollowUpApprove = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const reviewedAt = Date.now();
      const updateData = {
        nextFollowUpReviewedBySales: true,
        nextFollowUpReviewedByName: user.name,
        nextFollowUpReviewedAt: reviewedAt,
      };
      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), updateData);
      await logActivity(user.uid, user.name, `تأكيد موعد متابعة مقترح من الأتمتة`, client.id, working.name);
      onDone({ ...working, ...updateData });
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleFollowUpSaveEdit = async () => {
    if (!user || !fuDate) return;
    setSaving(true);
    try {
      const newTs = new Date(fuDate).getTime();
      const reviewedAt = Date.now();
      const updateData = {
        nextFollowUpDate: newTs,
        nextFollowUpReviewedBySales: true,
        nextFollowUpReviewedByName: user.name,
        nextFollowUpReviewedAt: reviewedAt,
      };
      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), updateData);
      await logActivity(user.uid, user.name, `تعديل موعد متابعة كان مُقترح من الأتمتة`, client.id, working.name);
      onDone({ ...working, ...updateData });
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleFollowUpCancel = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const reviewedAt = Date.now();
      const updateData = {
        nextFollowUpDate: 0,
        nextFollowUpReviewedBySales: true,
        nextFollowUpReviewedByName: user.name,
        nextFollowUpReviewedAt: reviewedAt,
      };
      await firestore.updateDoc(firestore.doc(db, 'clients', client.id), updateData);
      await logActivity(user.uid, user.name, `إلغاء موعد متابعة كان مُقترح من الأتمتة`, client.id, working.name);
      onDone({ ...working, ...updateData });
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg shadow-2xl">
        <div className="p-6 space-y-5">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles size={18} className="text-orange-500" />
              {phase === 'client' ? 'مراجعة عميل AI Generated' : 'تأكيد موعد متابعة مقترح'}
            </h2>
            <button onClick={onClose} className="sg-icon-btn bg-slate-50 dark:bg-slate-800 text-slate-400"><X size={16} /></button>
          </div>

          {phase === 'client' ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2">الاسم</label>
                <input className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2">رقم الهاتف</label>
                <input dir="ltr" className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none text-right" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2">رابط الحساب</label>
                <input dir="ltr" className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none text-right" value={form.profileLink} onChange={e => setForm({ ...form, profileLink: e.target.value })} placeholder="https://..." />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2">جملة مميزة للبحث</label>
                <textarea
                  className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none resize-none leading-relaxed"
                  rows={2}
                  value={form.distinctiveSearchPhrase}
                  onChange={e => setForm({ ...form, distinctiveSearchPhrase: e.target.value })}
                  placeholder="جملة حرفية من الشات تساعد في البحث داخل Meta"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase mr-2">المنصة</label>
                <select className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none" value={form.source} onChange={e => setForm({ ...form, source: e.target.value as ClientSource })}>
                  {Object.entries(SourceLabels).map(([k, v]) => <option key={k} value={k}>{v.ar}</option>)}
                </select>
              </div>
              <button onClick={handleAcceptClient} disabled={saving} className="w-full py-4 bg-primary-500 hover:bg-primary-600 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                <CheckCircle2 size={18} /> {saving ? 'جاري القبول...' : 'Accept'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {working.nextFollowUpReason && (
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-1">سبب الموعد ده حسب تحليل الأتمتة</p>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{working.nextFollowUpReason}</p>
                </div>
              )}
              {!editingFollowUp ? (
                <div className="p-5 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-2xl text-center">
                  <CalendarClock className="mx-auto text-orange-500 mb-2" size={24} />
                  <p className="text-lg font-black text-slate-900 dark:text-white">
                    {working.nextFollowUpDate ? new Date(working.nextFollowUpDate).toLocaleString('ar-EG', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                  </p>
                  {working.nextFollowUpMethod && (
                    <p className="text-[10px] font-black text-orange-600 dark:text-orange-400 mt-1">{CommMethodLabels[working.nextFollowUpMethod]?.ar}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase mr-2">الموعد الجديد</label>
                  <input type="datetime-local" className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none" value={fuDate} onChange={e => setFuDate(e.target.value)} />
                </div>
              )}

              {!editingFollowUp ? (
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={handleFollowUpApprove} disabled={saving} className="py-3.5 bg-primary-500 hover:bg-primary-600 text-white rounded-xl font-black text-[11px] flex flex-col items-center gap-1 disabled:opacity-50">
                    <CheckCircle2 size={16} /> موافقة
                  </button>
                  <button onClick={() => setEditingFollowUp(true)} className="py-3.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-black text-[11px] flex flex-col items-center gap-1">
                    <Edit2 size={16} /> تعديل
                  </button>
                  <button onClick={handleFollowUpCancel} disabled={saving} className="py-3.5 bg-rose-50 dark:bg-rose-500/10 text-rose-500 rounded-xl font-black text-[11px] flex flex-col items-center gap-1 disabled:opacity-50">
                    <XCircle size={16} /> إلغاء
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={handleFollowUpSaveEdit} disabled={saving || !fuDate} className="py-3.5 bg-primary-500 hover:bg-primary-600 text-white rounded-xl font-black text-[11px] disabled:opacity-50">
                    {saving ? 'جاري الحفظ...' : 'حفظ الموعد الجديد'}
                  </button>
                  <button onClick={() => setEditingFollowUp(false)} className="py-3.5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-xl font-black text-[11px]">
                    رجوع
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AcceptFlowModal;
