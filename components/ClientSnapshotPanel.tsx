import React, { useEffect, useMemo, useState } from 'react';
import { FileSearch, RefreshCw, Copy, Check, GraduationCap, AlertTriangle, CalendarClock, ClipboardList, Wallet, UserCheck, History } from 'lucide-react';
import { Client, ClientSnapshot360, SnapBooking, SnapCourse, SnapStudent } from '../types';
import { pullClientSnapshot } from '../clientSnapshotService';
import { Badge } from './ui';

// "ملف العميل": everything the other systems know about this client, pulled on demand.
// The data is read from clients/{id}.snapshot360 (the page's existing listener); the only thing
// that costs anything is pressing the button.

const plural = (n: number, one: string, two: string, few: string, many: string) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
export function agoAr(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return 'أقل من دقيقة';
  const m = Math.floor(s / 60);
  if (m < 60) return plural(m, 'دقيقة', 'دقيقتين', 'دقايق', 'دقيقة');
  const h = Math.floor(m / 60);
  if (h < 24) return plural(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة');
  const d = Math.floor(h / 24);
  return plural(d, 'يوم', 'يومين', 'أيام', 'يوم');
}

const money = (n?: number) => `${(n || 0).toLocaleString('ar-EG')} ج`;
const day = (d?: string | null) => {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return '—';
  return new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
};
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

const COURSE_STATUS: Record<string, { label: string; tone: 'good' | 'danger' | 'warning' | 'neutral' }> = {
  ACTIVE: { label: 'شغّال', tone: 'good' }, REFUNDED: { label: 'مسترد', tone: 'danger' },
  DEACTIVATED: { label: 'موقوف', tone: 'warning' }, DELETED: { label: 'ملغي', tone: 'danger' }, UNMATCHED: { label: 'من التدريب بس', tone: 'neutral' },
};
const INSTALLMENT_STATUS: Record<string, string> = { paid: 'مدفوع', pending: 'مستحق', delayed: 'متأخر', cancelled: 'ملغي' };

const Stat: React.FC<{ label: string; children: React.ReactNode; tone?: 'danger' | 'good' }> = ({ label, children, tone }) => (
  <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl min-w-0">
    <p className="text-[10px] font-black text-slate-400 mb-1">{label}</p>
    <p className="font-black text-sm" style={tone ? { color: `var(--sg-${tone})` } : undefined}>{children}</p>
  </div>
);

interface Props {
  client: Client;
  canPull: boolean;
  onMarkAlumni: () => Promise<void>;
}

const ClientSnapshotPanel: React.FC<Props> = ({ client, canPull, onMarkAlumni }) => {
  const snap: ClientSnapshot360 | undefined = client.snapshot360;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [marking, setMarking] = useState(false);
  const [selected, setSelected] = useState('');
  const [, tick] = useState(0);

  // "اتسحب من 3 ساعات" stays fresh without any read.
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t); }, []);

  const courses: SnapCourse[] = snap?.courses || [];
  useEffect(() => {
    if (!courses.length) { setSelected(''); return; }
    if (!courses.some((c) => c.bookingId === selected)) setSelected((courses.find((c) => c.status === 'ACTIVE') || courses[0]).bookingId);
  }, [snap?.pulledAt, courses.length]);

  const pull = async (force: boolean) => {
    setLoading(true); setError('');
    try { await pullClientSnapshot(client.id, force); } // the listener on the client document delivers the result
    catch (e: any) { setError(e?.message || 'ماقدرناش نسحب ملف العميل دلوقتي.'); }
    finally { setLoading(false); }
  };

  const copyBriefing = async () => {
    if (!snap?.briefing) return;
    await navigator.clipboard.writeText(snap.briefing);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const markAlumni = async () => {
    setMarking(true);
    try { await onMarkAlumni(); } finally { setMarking(false); }
  };

  const course = courses.find((c) => c.bookingId === selected);
  const booking: SnapBooking | undefined = snap?.accounting?.bookings?.find((b) => b.id === selected);
  const student: SnapStudent | undefined = snap?.training?.students?.find((s) => s.sourceBookingId === selected);
  const activeCount = courses.filter((c) => c.status === 'ACTIVE').length;
  const alumniDue = snap?.lifecycle?.state === 'alumni_due' && client.isAlumni !== true;
  const today = useMemo(todayStr, [snap?.pulledAt]);

  return (
    <section className="sgui-panel p-5 md:p-6 space-y-5" aria-label="ملف العميل">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <span className="sgui-row-icon"><FileSearch size={20} /></span>
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white">ملف العميل</h3>
            <p className="text-[11px] font-bold text-slate-500 mt-0.5">
              {snap ? `اتسحب من ${agoAr(snap.pulledAt)}${snap.pulledByName ? ` — ${snap.pulledByName}` : ''} · ` : ''}بيتسحب عند الطلب بس
            </p>
          </div>
        </div>
        {canPull && (
          <button onClick={() => pull(!!snap)} disabled={loading} className="sgui-button is-primary">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            {loading ? 'بنسحب البيانات...' : snap ? 'تحديث' : 'سحب ملف العميل'}
          </button>
        )}
      </div>

      {error && (
        <div className="sgui-info-card is-danger" role="alert">
          <span className="sgui-row-icon"><AlertTriangle size={18} /></span>
          <div className="min-w-0"><strong className="!text-sm">{error}</strong></div>
        </div>
      )}

      {!snap && !loading && !error && (
        <p className="text-xs font-bold text-slate-500 leading-relaxed">
          دوس "سحب ملف العميل" علشان تشوف كورساته ودفعاته وحضوره وآخر متابعاته وملخص قبل المكالمة. مفيش حاجة بتتحمّل لوحدها.
        </p>
      )}

      {snap && (
        <>
          {(snap.accountingError || snap.trainingError) && (
            <div className="sgui-info-card is-warning" role="status">
              <span className="sgui-row-icon"><AlertTriangle size={18} /></span>
              <div className="min-w-0 text-xs font-bold leading-relaxed">
                {snap.accountingError && <p>نظام الحسابات: {snap.accountingError}</p>}
                {snap.trainingError && <p>نظام التدريب: {snap.trainingError}</p>}
                <p className="text-slate-500">الملف ناقص. دوس "تحديث" بعد شوية.</p>
              </div>
            </div>
          )}

          {alumniDue && (
            <div className="sgui-info-card is-warning items-start" role="status">
              <span className="sgui-row-icon"><GraduationCap size={18} /></span>
              <div className="min-w-0 flex-1">
                <strong className="!text-sm">الكورس خلص من أكتر من أسبوع. حوّله لعميل سابق؟</strong>
                <small className="block mt-0.5">آخر محاضرة {day(snap.lifecycle.courseEndsAt)}. هيتوقف الاطمئنان كل أسبوعين.</small>
                {canPull && <button onClick={markAlumni} disabled={marking} className="sgui-button is-primary mt-3"><GraduationCap size={16} /> {marking ? 'جاري التحويل...' : 'حوّله لعميل سابق'}</button>}
              </div>
            </div>
          )}

          {/* Briefing */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-black flex items-center gap-2"><ClipboardList size={16} /> ملخص قبل المكالمة</h4>
              {snap.briefing && (
                <button onClick={copyBriefing} className="sgui-icon-button" title="نسخ الملخص" aria-label="نسخ الملخص">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
              )}
            </div>
            {snap.briefing ? (
              <p className="sg-surface p-4 text-sm font-bold leading-loose whitespace-pre-wrap text-slate-700 dark:text-slate-200">{snap.briefing}</p>
            ) : (
              <p className="text-xs font-bold text-slate-500">ماقدرناش نجهّز الملخص المرة دي، بس البيانات تحت كاملة. دوس "تحديث" تجرب تاني.</p>
            )}
          </div>

          {/* Courses */}
          <div className="space-y-2">
            <h4 className="text-sm font-black flex items-center gap-2">
              <UserCheck size={16} /> الكورسات
              {activeCount >= 2 && <Badge tone="info">اشترى {activeCount} كورسات</Badge>}
            </h4>
            {courses.length === 0 ? (
              <p className="text-xs font-bold text-slate-500">مفيش كورسات متسجلة للعميل ده في الحسابات.</p>
            ) : (
              <div className="space-y-2">
                {courses.map((c) => {
                  const st = COURSE_STATUS[c.status] || { label: c.status, tone: 'neutral' as const };
                  const isSel = c.bookingId === selected;
                  return (
                    <button key={c.bookingId || c.name} type="button" onClick={() => setSelected(c.bookingId)} aria-pressed={isSel}
                      className={`w-full text-right rounded-xl border p-3 transition-colors ${isSel ? 'border-slate-400 dark:border-slate-500 bg-slate-50 dark:bg-slate-800' : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <span className="font-black text-sm min-w-0 truncate">{c.name || 'كورس'}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-[11px] font-bold text-slate-500">
                        <span>من {day(c.startDate)}</span>
                        <span>لحد {day(c.endDate)}</span>
                        <span className="truncate">{c.groupName ? `المجموعة: ${c.groupName}` : 'مجموعة: —'}</span>
                        <span>القسط الجاي: {c.nextDue ? `${day(c.nextDue)} (${money(c.nextDueAmount)})` : '—'}</span>
                        <span>مدفوع: <b className="text-slate-700 dark:text-slate-200">{money(c.paid)}</b></span>
                        <span>متبقي: <b style={c.remaining > 0 ? { color: 'var(--sg-warning)' } : undefined}>{money(c.remaining)}</b></span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {course && (
            <>
              {/* Payments of the selected course */}
              <div className="space-y-2">
                <h4 className="text-sm font-black flex items-center gap-2"><Wallet size={16} /> الدفع — {course.name}</h4>
                {booking ? (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <Stat label="سعر الكورس">{money(booking.pricing?.finalPrice)}</Stat>
                      <Stat label="المدفوع" tone="good">{money(booking.paid)}</Stat>
                      <Stat label="المتبقي" tone={booking.remaining > 0 ? 'danger' : undefined}>{money(booking.remaining)}</Stat>
                      <Stat label="آخر دفعة">{booking.lastPayment ? `${money(booking.lastPayment.amount)} — ${day(booking.lastPayment.date)}` : 'لسه مفيش'}</Stat>
                    </div>
                    {(booking.installments?.length || 0) > 0 ? (
                      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-right text-xs">
                          <thead><tr className="text-[10px] text-slate-400 font-black"><th className="p-2.5">الميعاد</th><th className="p-2.5">القسط</th><th className="p-2.5">المدفوع</th><th className="p-2.5">الحالة</th></tr></thead>
                          <tbody>
                            {booking.installments!.map((i, idx) => {
                              const isNext = booking.nextDue?.date === i.dueDate && i.status !== 'paid' && i.status !== 'cancelled';
                              const late = i.status === 'delayed' || (i.status === 'pending' && i.dueDate < today && (i.paidAmount || 0) < i.amount);
                              return (
                                <tr key={`${i.dueDate}-${idx}`} className="border-t border-slate-100 dark:border-slate-800 font-bold" style={late ? { color: 'var(--sg-danger)' } : undefined}
                                  data-next={isNext || undefined}>
                                  <td className="p-2.5 whitespace-nowrap">{day(i.dueDate)}{isNext && <span className="sgui-state is-info mr-2">القسط الجاي</span>}</td>
                                  <td className="p-2.5">{money(i.amount)}</td>
                                  <td className="p-2.5">{money(i.paidAmount)}</td>
                                  <td className="p-2.5">{late && i.status !== 'delayed' ? 'متأخر' : INSTALLMENT_STATUS[i.status] || i.status}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-xs font-bold text-slate-500">مفيش أقساط متسجلة للحجز ده.</p>}
                  </>
                ) : <p className="text-xs font-bold text-slate-500">مفيش بيانات دفع للكورس ده (نظام الحسابات ماردش أو الكورس مش متسجل هناك).</p>}
              </div>

              {/* Attendance of the selected course */}
              <div className="space-y-2">
                <h4 className="text-sm font-black flex items-center gap-2"><CalendarClock size={16} /> الحضور — {course.name}</h4>
                {student ? (() => {
                  const pct = Math.max(0, Math.min(100, Math.round(student.attendancePct || 0)));
                  const streak = student.absenceStreak || 0;
                  return (
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs font-black mb-1.5">
                          <span>حضر {student.attended ?? 0} من {student.heldSessions ?? 0} محاضرة</span><span>{pct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 70 ? 'var(--sg-good)' : pct >= 40 ? 'var(--sg-warning)' : 'var(--sg-danger)' }} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <Stat label="آخر محاضرة وصل لها">{student.lastAttended ? `رقم ${student.lastAttended.sessionNumber} — ${day(student.lastAttended.date)}` : 'لسه ماحضرش'}</Stat>
                        <Stat label="التاسكات">{student.tasks ? `${student.tasks.delivered} من ${student.tasks.required}` : '—'}</Stat>
                        <Stat label="بوابة الطالب">{student.portal?.hasLoggedIn ? `آخر دخول ${day(student.portal.lastLoginAt || '')}` : 'لسه ما دخلش'}</Stat>
                        <Stat label="عدد المحاضرات">{student.totalSessions ?? '—'}</Stat>
                      </div>
                      {streak >= 2 && (
                        <div className="sgui-info-card is-warning" role="status">
                          <span className="sgui-row-icon"><AlertTriangle size={18} /></span>
                          <div><strong className="!text-sm">غاب {streak} محاضرات ورا بعض</strong><small>كلّمه واطمّن عليه.</small></div>
                        </div>
                      )}
                      {student.access?.deactivated && <Badge tone="danger">الحساب موقوف في التدريب{student.access.reasonCategory ? ` (${student.access.reasonCategory})` : ''}</Badge>}
                    </div>
                  );
                })() : (
                  <p className="text-xs font-bold text-slate-500">
                    {snap.trainingError ? 'نظام التدريب ماردش المرة دي.' : 'مفيش بيانات حضور للكورس ده (لسه مابدأش أو مش متسجل في التدريب).'}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Last follow-ups (the full timeline stays below on the page) */}
          <div className="space-y-2">
            <h4 className="text-sm font-black flex items-center gap-2"><History size={16} /> آخر المتابعات</h4>
            {snap.followUps?.length ? (
              <ul className="space-y-2">
                {snap.followUps.map((f, i) => (
                  <li key={`${f.at}-${i}`} className="sg-surface p-3 text-xs font-bold leading-relaxed">
                    <div className="flex flex-wrap gap-2 text-[10px] text-slate-400 font-black mb-1">
                      <span>{f.at ? new Date(f.at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) : ''}</span>
                      {f.by && <span>{f.by}</span>}
                      {f.kind === 'auto_booked' && <span>اطمئنان</span>}
                    </div>
                    <p className="text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{f.result || '—'}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs font-bold text-slate-500">مفيش متابعات متسجلة لسه.</p>}
          </div>
        </>
      )}
    </section>
  );
};

export default ClientSnapshotPanel;
