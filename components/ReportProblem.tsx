import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// "Report a problem" for staff. The same component is copied into every system; only `system` and
// `getIdToken` change. The report goes to the shared staffReport function, which stores it, alerts the
// owner and starts the triage. The employee gets a ticket number at once and sees replies under "بلاغاتي".
const ENDPOINT = 'https://us-central1-sg-tms-v2.cloudfunctions.net/staffReport';

interface Mine { ticket: string; title: string; message: string; status: string; createdAt: number; replies: { at: number; text: string }[] }
const STATUS: Record<string, string> = { new: 'وصل', triaging: 'بنشتغل عليه', waiting: 'مستنيين الموافقة', done: 'اتحل', closed: 'اتقفل' };
const fmt = (ms: number) => new Date(ms).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });

async function post(body: Record<string, unknown>) {
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || 'حصل خطأ. جرّب تاني.');
  return data;
}

const ReportProblem: React.FC<{ system: 'training' | 'accounting' | 'crm' | 'audit'; getIdToken: () => Promise<string> }> = ({ system, getIdToken }) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'new' | 'mine'>('new');
  const [title, setTitle] = useState(''); const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [ticket, setTicket] = useState('');
  const [mine, setMine] = useState<Mine[]>([]);

  useEffect(() => {
    if (!open || tab !== 'mine') return;
    (async () => {
      try { setMine((await post({ action: 'mine', system, idToken: await getIdToken() })).reports); }
      catch (e: any) { setError(e.message); }
    })();
  }, [open, tab]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const data = await post({ action: 'submit', system, title, message, pageUrl: window.location.href, idToken: await getIdToken() });
      setTicket(data.ticket); setTitle(''); setMessage('');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  const close = () => { setOpen(false); setTicket(''); setError(''); setTab('new'); };

  // Portal to <body>: a page-level animation with a transform would otherwise trap position:fixed inside the page.
  return createPortal(
    <>
      <button onClick={() => setOpen(true)} className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-black px-4 py-2.5 shadow-xl" aria-label="بلّغ عن مشكلة">
        <span aria-hidden="true">🛟</span> بلّغ عن مشكلة
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/50" dir="rtl" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl p-5 font-arabic max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-black">بلّغ عن مشكلة</h3>
              <button onClick={close} aria-label="إغلاق"><span className="text-xl leading-none" aria-hidden="true">×</span></button>
            </div>
            <div className="flex gap-2 mb-4 text-xs font-black">
              {([['new', 'بلاغ جديد'], ['mine', 'بلاغاتي']] as const).map(([k, l]) => (
                <button key={k} onClick={() => { setTab(k); setError(''); }} className={`px-3 py-1.5 rounded-xl border ${tab === k ? 'bg-blue-600 text-white border-blue-500' : 'border-slate-300 dark:border-slate-700'}`}>{l}</button>
              ))}
            </div>
            {error && <p className="text-xs font-bold text-rose-600 mb-3">{error}</p>}
            {tab === 'new' && (ticket ? (
              <div className="text-center py-6 space-y-2">
                <div className="text-4xl" aria-hidden="true">✅</div>
                <p className="font-black">البلاغ وصل ✅</p>
                <p className="text-sm">رقمه <b dir="ltr">{ticket}</b></p>
                <p className="text-xs text-slate-500">هنبدأ نشتغل عليه، وهتلاقي الرد في "بلاغاتي".</p>
              </div>
            ) : (
              <form onSubmit={send} className="space-y-3">
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="عنوان قصير (اختياري)" className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm" />
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} required minLength={5} maxLength={3000} rows={6} placeholder="إيه المشكلة؟ اكتب اسم العميل أو الطالب أو الجروب والرقم اللي غلط وإيه المفروض يكون." className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm" />
                <p className="text-[11px] text-slate-500">الصفحة اللي إنت فيها بتتبعت لوحدها مع البلاغ.</p>
                <button disabled={busy} className="w-full rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black py-2.5 text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                  {busy ? 'جاري الإرسال…' : 'إرسال البلاغ'}
                </button>
              </form>
            ))}
            {tab === 'mine' && (
              <div className="space-y-3">
                {mine.map((r) => (
                  <div key={r.ticket} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 text-xs">
                    <div className="flex justify-between font-black"><span dir="ltr">{r.ticket}</span><span>{STATUS[r.status] || r.status}</span></div>
                    <p className="mt-1">{r.title || r.message.slice(0, 80)}</p>
                    <p className="text-[10px] text-slate-500 mt-1">{fmt(r.createdAt)}</p>
                    {r.replies.map((x, i) => <p key={i} className="mt-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-2">{x.text}</p>)}
                  </div>
                ))}
                {!mine.length && !error && <p className="text-center text-slate-500 text-xs py-6">مفيش بلاغات لسه.</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </>,
    document.body
  );
};

export default ReportProblem;
