import React from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

// Page navigation for usePagedQuery / usePagedList (same behavior as the accounting Pager).
// Pages that can be opened cheaply (already opened, or the next one) are buttons; jumping
// further ahead is disabled because it would read every page in between.
interface PagerProps {
  page: number;
  pageCount: number;
  reachablePage: number;
  total: number | null;
  pageSize: number;
  loading?: boolean;
  onPage: (page: number) => void;
  noun?: string;
}

const Pager: React.FC<PagerProps> = ({ page, pageCount, reachablePage, total, pageSize, loading, onPage, noun = '' }) => {
  if (total === 0) return null;
  const lastOpenable = Math.min(pageCount, Math.max(reachablePage, page));
  const nums = new Set<number>([1, page - 1, page, page + 1, lastOpenable]);
  const shown = Array.from(nums).filter(n => n >= 1 && n <= lastOpenable).sort((a, b) => a - b);
  const from = (page - 1) * pageSize + 1;
  const to = total === null ? page * pageSize : Math.min(total, page * pageSize);
  if (total !== null && total <= pageSize && page === 1) {
    return <nav className="sgui-pager" aria-label="التنقل بين الصفحات"><p>{total.toLocaleString('ar-EG')} {noun}</p></nav>;
  }

  return (
    <nav className="sgui-pager" aria-label="التنقل بين الصفحات">
      <p>
        {total === null
          ? `صفحة ${page.toLocaleString('ar-EG')}`
          : `${from.toLocaleString('ar-EG')}–${to.toLocaleString('ar-EG')} من ${total.toLocaleString('ar-EG')} ${noun} · صفحة ${page.toLocaleString('ar-EG')} من ${pageCount.toLocaleString('ar-EG')}`}
      </p>
      <div>
        <button type="button" disabled={loading || page <= 1} onClick={() => onPage(page - 1)} aria-label="الصفحة السابقة"><ChevronRight size={16} /></button>
        {shown.map((n, i) => (
          <React.Fragment key={n}>
            {i > 0 && n - shown[i - 1] > 1 && <span aria-hidden="true">…</span>}
            <button type="button" className={n === page ? 'is-active' : ''} aria-current={n === page ? 'page' : undefined} disabled={loading} onClick={() => onPage(n)}>
              {n.toLocaleString('ar-EG')}
            </button>
          </React.Fragment>
        ))}
        {pageCount > lastOpenable && (
          <>
            <span aria-hidden="true">…</span>
            <button type="button" disabled title="افتح الصفحات بالترتيب؛ القفز لآخر صفحة بيقرا كل اللي قبلها">{pageCount.toLocaleString('ar-EG')}</button>
          </>
        )}
        <button type="button" disabled={loading || page >= pageCount || page >= reachablePage} onClick={() => onPage(page + 1)} aria-label="الصفحة التالية">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </nav>
  );
};

export default Pager;
