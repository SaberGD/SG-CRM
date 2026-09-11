import React, { useEffect, useState } from 'react';
import { useShift, BREAK_DURATION_MS, BREAK_GRACE_MS } from '../ShiftContext';
import { Clock, Coffee, Square } from 'lucide-react';

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const ShiftWidget: React.FC = () => {
  const { shift, startBreak, endBreak, openEndModal } = useShift();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!shift || (shift.status !== 'active' && shift.status !== 'on_break')) return null;

  const elapsedWorkMs = shift.startedAt ? now - shift.startedAt : 0;
  const currentBreak = shift.status === 'on_break' ? shift.breaks[shift.breaks.length - 1] : null;
  const breakElapsedMs = currentBreak ? now - currentBreak.startedAt : 0;
  const breakRemainingMs = BREAK_DURATION_MS - breakElapsedMs;
  const isBreakLate = breakElapsedMs > (BREAK_DURATION_MS + BREAK_GRACE_MS);

  return (
    <div className={`sg-surface !rounded-2xl px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-3 ${shift.status === 'on_break' ? 'bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${shift.status === 'on_break' ? 'bg-amber-500/20 text-amber-600' : 'bg-primary-50 dark:bg-primary-500/10 text-primary-500'}`}>
          <Clock size={18} />
        </div>
        <div>
          {shift.status === 'on_break' ? (
            <>
              <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase">معاك بريك 30 دقيقة</p>
              <p className={`text-sm font-black ${isBreakLate ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
                {breakRemainingMs > 0 ? `متبقي ${formatDuration(breakRemainingMs)}` : isBreakLate ? `متأخر ${formatDuration(breakElapsedMs - BREAK_DURATION_MS - BREAK_GRACE_MS)}` : 'البريك خلص، نكمل شغل؟'}
              </p>
            </>
          ) : (
            <>
              <p className="text-[10px] font-black text-slate-400 uppercase">
                انت بدأت شغل من الساعة {shift.startedAt ? new Date(shift.startedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''}
              </p>
              <p className="text-sm font-black text-slate-900 dark:text-white">{formatDuration(elapsedWorkMs)}</p>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {shift.status === 'active' ? (
          <button onClick={startBreak} className="sg-btn sg-btn-secondary !py-2.5 !px-4 text-[11px]">
            <Coffee size={14} /> بريك
          </button>
        ) : (
          <button onClick={endBreak} className="sg-btn sg-btn-warning !py-2.5 !px-4 text-[11px]">
            <Coffee size={14} /> {breakRemainingMs > 0 ? 'إنهاء البريك دلوقتي' : 'البريك خلص، نكمل شغل'}
          </button>
        )}
        <button onClick={openEndModal} className="sg-btn sg-btn-danger !py-2.5 !px-4 text-[11px]">
          <Square size={14} /> خلصت شغل!
        </button>
      </div>
    </div>
  );
};

export default ShiftWidget;
