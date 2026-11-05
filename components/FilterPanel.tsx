import React, { useEffect, useState } from 'react';
import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';

// Filters in two levels, same idea as the accounting filter panel: the filters people use
// every day are always visible; the rest sit behind "فلاتر متقدمة" and open by themselves
// when one of them is in use.
export const Field: React.FC<{ label: string; children: React.ReactNode; wide?: boolean }> = ({ label, children, wide }) => (
  <label className={`sgui-field ${wide ? 'is-wide' : ''}`}>
    <span>{label}</span>
    {children}
  </label>
);

const FilterPanel: React.FC<{
  main: React.ReactNode;
  advanced?: React.ReactNode;
  advancedCount?: number;
  activeCount?: number;
  onReset?: () => void;
}> = ({ main, advanced, advancedCount = 0, activeCount = 0, onReset }) => {
  const [open, setOpen] = useState(advancedCount > 0);
  useEffect(() => { if (advancedCount > 0) setOpen(true); }, [advancedCount]);

  return (
    <section className="sgui-filter-panel" aria-label="الفلاتر">
      <div className="sgui-filter-main">
        {main}
        {(advanced || onReset) && (
          <div className="sgui-filter-tools">
            {advanced && (
              <button type="button" className={`sgui-button ${open ? 'is-open' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open}>
                <SlidersHorizontal size={16} aria-hidden="true" />
                فلاتر متقدمة
                {advancedCount > 0 && <span className="sgui-count">{advancedCount}</span>}
                <ChevronDown size={15} aria-hidden="true" className={open ? 'rotate-180' : ''} />
              </button>
            )}
            {onReset && activeCount > 0 && (
              <button type="button" className="sgui-button" onClick={onReset}>
                <RotateCcw size={15} aria-hidden="true" /> مسح الفلاتر
              </button>
            )}
          </div>
        )}
      </div>
      {advanced && open && <div className="sgui-filter-advanced">{advanced}</div>}
    </section>
  );
};

export default FilterPanel;
