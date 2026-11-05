import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X, Send, Loader2 } from 'lucide-react';
import { askMaro, ChatMessage } from '../assistantService';

const SUGGESTIONS = ['شغلي النهارده إيه؟', 'مين العملاء المهتمين من غير موعد متابعة؟', 'لاقيلي عميل برقم أو اسم', 'اكتبلي رسالة واتساب متابعة'];

// Renders [اسم](client:ID) as a link to the client page; everything else is plain text.
const renderReply = (text: string, onNavigate: () => void) => {
  const parts: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\(client:([A-Za-z0-9_-]+)\)/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<Link key={`l${i++}`} to={`/clients/${m[2]}`} onClick={onNavigate} className="font-black underline text-primary-600 dark:text-primary-400">{m[1]}</Link>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
};

// Floating assistant. Uses explicit light AND dark classes everywhere so it looks right in both themes.
const MaroAssistant: React.FC<{ ask?: (m: ChatMessage[]) => Promise<string> }> = ({ ask = askMaro }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy, open]);

  const send = async (raw?: string) => {
    const q = (raw ?? text).trim();
    if (!q || busy) return;
    const next = [...msgs, { role: 'user', content: q } as ChatMessage];
    setMsgs(next); setText(''); setBusy(true); setError('');
    try { setMsgs([...next, { role: 'assistant', content: await ask(next) }]); }
    catch (e: any) { setError(e?.message || 'حصل خطأ.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label="مارو المساعد الذكي"
          className="fixed bottom-5 left-5 z-[900] h-14 px-5 rounded-full bg-primary-600 text-white font-black shadow-xl shadow-primary-600/30 flex items-center gap-2 hover:bg-primary-700 transition">
          <Sparkles size={20} /> مارو
        </button>
      )}
      {open && (
        <div dir="rtl" className="fixed bottom-5 left-5 z-[900] w-[min(92vw,400px)] h-[min(78vh,600px)] flex flex-col rounded-3xl overflow-hidden bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 shadow-2xl">
          <header className="flex items-center justify-between px-4 py-3 bg-primary-600 text-white">
            <div className="flex items-center gap-2 font-black"><Sparkles size={18} /> مارو · مساعد المبيعات</div>
            <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="p-1.5 rounded-lg hover:bg-white/15"><X size={18} /></button>
          </header>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-950">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">أهلاً! اسألني عن عملاءك أو شغلك النهارده، وأنا أجاوبك من بيانات السيستم (قراءة فقط).</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="text-xs font-bold px-3 py-2 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-primary-500">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-7 whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary-600 text-white' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100'}`}>
                  {m.role === 'assistant' ? renderReply(m.content, () => setOpen(false)) : m.content}
                </div>
              </div>
            ))}
            {busy && <div className="flex justify-end"><div className="rounded-2xl px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> بدوّر في البيانات…</div></div>}
            {error && <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 text-xs font-bold p-3">{error}</div>}
            <div ref={endRef} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 p-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="اسأل مارو…" maxLength={1000}
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 px-3 py-2.5 text-sm outline-none focus:border-primary-500" />
            <button type="submit" disabled={busy || !text.trim()} aria-label="إرسال" className="h-10 w-10 rounded-xl bg-primary-600 text-white flex items-center justify-center disabled:opacity-40"><Send size={16} className="-scale-x-100" /></button>
          </form>
        </div>
      )}
    </>
  );
};

export default MaroAssistant;
