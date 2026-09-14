import React, { useEffect, useState } from 'react';
import { useShift, BREAK_DAILY_BUDGET_MS, BREAK_GRACE_MS, MAX_BREAK_SEGMENTS, getUsedBreakMs } from '../ShiftContext';
import { formatDuration } from '../utils/time';
import { Clock, Coffee, Square } from 'lucide-react';

const ShiftWidget: React.FC = () => {
  const { shift, startBreak, endBreak, openEndModal } = useShift();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!shift || (shift.status !== 'active' && shift.status !== 'on_break')) return null;

  const elapsedWorkMs = shift.startedAt ? now - shift.startedAt : 0;
  const breaks = shift.breaks || [];
  const currentBreak = shift.status === 'on_break' ? breaks[breaks.length - 1] : null;
  const usedBreakMs = getUsedBreakMs(breaks); // closed segments only
  const breakElapsedMs = currentBreak ? now - currentBreak.startedAt : 0;
  const breakRemainingMs = (BREAK_DAILY_BUDGET_MS - usedBreakMs) - breakElapsedMs;
  const isBreakLate = (usedBreakMs + breakElapsedMs) > (BREAK_DAILY_BUDGET_MS + BREAK_GRACE_MS);
  const segmentsUsed = breaks.length;
  const breakExhausted = segmentsUsed >= MAX_BREAK_SEGMENTS || usedBreakMs >= BREAK_DAILY_BUDGET_MS;
  const remainingBudgetMs = Math.max(0, BREAK_DAILY_BUDGET_MS - usedBreakMs);

  return (
    <div className={`sg-surface !rounded-2xl px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-3 ${shift.status === 'on_break' ? 'bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${shift.status === 'on_break' ? 'bg-amber-500/20 text-amber-600' : 'bg-primary-50 dark:bg-primary-500/10 text-primary-500'}`}>
          <Clock size={18} />
        </div>
        <div>
          {shift.status === 'on_break' ? (
            <>
              <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase">بريك ({segmentsUsed}/{MAX_BREAK_SEGMENTS})</p>
              <p className={`text-sm font-black ${isBreakLate ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
                {breakRemainingMs > 0 ? `متبقي ${formatDuration(breakRemainingMs)}` : isBreakLate ? `متأخر ${formatDuration((usedBreakMs + breakElapsedMs) - BREAK_DAILY_BUDGET_MS - BREAK_GRACE_MS)}` : 'البريك خلص، نكمل شغل؟'}
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
          breakExhausted ? (
            <span className="text-[10px] font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-4 py-2.5 rounded-xl">
              بريك النهاردة خلص
            </span>
          ) : (
            <button onClick={startBreak} className="sg-btn sg-btn-secondary !py-2.5 !px-4 text-[11px]">
              <Coffee size={14} /> بريك {segmentsUsed > 0 ? `(متبقي ${formatDuration(remainingBudgetMs)})` : ''}
            </button>
          )
        ) : (
          <button onClick={endBreak} className="sg-btn sg-btn-warning !py-2.5 !px-4 text-[11px]">
            <Coffee size={14} /> {breakRemainingMs > 0 ? 'إنهاء البريك دلوقتي' : 'أكدت إني رجعت، نكمل شغل'}
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
