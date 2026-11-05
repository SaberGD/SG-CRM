import React, { useMemo, useState } from 'react';
import { QueryConstraint, where } from 'firebase/firestore';
import { ActivityLog } from '../types';
import { Clock, UserPlus, Edit3, PhoneIncoming, ClipboardList } from 'lucide-react';
import { PageHeader, EmptyState, LoadingState } from '../components/ui';
import FilterPanel, { Field } from '../components/FilterPanel';
import Pager from '../components/Pager';
import { usePagedQuery } from '../utils/usePagedQuery';
import { useStaff } from '../utils/refData';

const DAY = 86400000;

// Activity log: 10 per page, read page by page (it used to keep a live listener on the last 50).
const ActivityLogs: React.FC = () => {
  const staff = useStaff();
  const people = useMemo(() => staff.filter(u => !u.isDeactivated).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar')), [staff]);
  const [userId, setUserId] = useState('all');
  const [day, setDay] = useState('');

  const constraints = useMemo(() => {
    const c: QueryConstraint[] = [];
    if (userId !== 'all') c.push(where('userId', '==', userId));
    if (day) {
      const d = new Date(day); d.setHours(0, 0, 0, 0);
      c.push(where('timestamp', '>=', d.getTime()), where('timestamp', '<', d.getTime() + DAY));
    }
    return c;
  }, [userId, day]);

  const logs = usePagedQuery<ActivityLog>({
    collectionName: 'logs', constraints, queryKey: JSON.stringify([userId, day]), orderField: 'timestamp', orderDirection: 'desc',
  });

  const getIcon = (action: string) => {
    if (action.includes('إضافة')) return <span className="sgui-row-icon is-good"><UserPlus size={18} /></span>;
    if (action.includes('تعديل') || action.includes('تحديث')) return <span className="sgui-row-icon is-warning"><Edit3 size={18} /></span>;
    return <span className="sgui-row-icon"><PhoneIncoming size={18} /></span>;
  };

  return (
    <div className="sg-page space-y-6 animate-fade-in">
      <PageHeader title="سجل النشاطات" subtitle="مين عمل إيه وإمتى في النظام" />

      <FilterPanel
        activeCount={(userId !== 'all' ? 1 : 0) + (day ? 1 : 0)}
        advancedCount={day ? 1 : 0}
        onReset={() => { setUserId('all'); setDay(''); }}
        main={
          <Field label="الموظف">
            <select value={userId} onChange={e => setUserId(e.target.value)}>
              <option value="all">كل الموظفين</option>
              {people.map(u => <option key={u.uid} value={u.uid}>{u.name || u.email}</option>)}
            </select>
          </Field>
        }
        advanced={
          <Field label="يوم معيّن">
            <input type="date" value={day} onChange={e => setDay(e.target.value)} />
          </Field>
        }
      />

      <section className="sgui-panel p-4 md:p-5">
        {logs.loading && logs.rows.length === 0 ? <LoadingState label="جاري تحميل السجلات..." /> : logs.rows.length === 0 ? (
          <EmptyState icon={ClipboardList}>مفيش نشاطات هنا</EmptyState>
        ) : (
          <div className="sgui-list">
            {logs.rows.map((log) => (
              <div key={log.id} className="sgui-row is-static">
                {getIcon(log.action || '')}
                <div className="sgui-row-main">
                  <p className="sgui-row-text"><b>{log.userName}</b> {log.action}{log.targetName && <> · <b>{log.targetName}</b></>}</p>
                  <small>{new Date(log.timestamp).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}</small>
                </div>
                <span className="sgui-state"><Clock size={12} /> {new Date(log.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        )}
        <Pager page={logs.page} pageCount={logs.pageCount} reachablePage={logs.reachablePage} total={logs.total} pageSize={logs.pageSize} loading={logs.loading} onPage={logs.goToPage} noun="نشاط" />
      </section>
    </div>
  );
};

export default ActivityLogs;
