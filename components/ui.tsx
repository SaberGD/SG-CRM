// Shared page building blocks. Same class names and look as the accounting system (sgui-*).
import React from 'react';

export const PageHeader: React.FC<{ title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
  <header className="sgui-heading">
    <div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {actions && <div className="sgui-heading-actions">{actions}</div>}
  </header>
);

export const SectionTitle: React.FC<{ title: React.ReactNode; icon?: React.ReactNode; count?: number; action?: React.ReactNode }> = ({ title, icon, count, action }) => (
  <div className="sgui-section-title">
    <h2>{icon}{title}{count !== undefined && <span className="sgui-count">{count}</span>}</h2>
    {action}
  </div>
);

type Tone = 'neutral' | 'good' | 'warning' | 'danger' | 'info';

export const StatCard: React.FC<{ label: string; value: React.ReactNode; icon?: React.ElementType; tone?: Tone; hint?: string }> = ({ label, value, icon: Icon, tone = 'neutral', hint }) => (
  <div className={`sgui-stat is-${tone}`}>
    <div className="sgui-stat-top">
      <span>{label}</span>
      {Icon && <Icon size={18} aria-hidden="true" />}
    </div>
    <strong>{value}</strong>
    {hint && <small>{hint}</small>}
  </div>
);

export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string }> = ({ tone = 'neutral', children, className = '' }) => (
  <span className={`sgui-state ${tone === 'neutral' ? '' : `is-${tone}`} ${className}`}>{children}</span>
);

export const Tabs = <T extends string>({ value, onChange, items, label }: {
  value: T; onChange: (v: T) => void; label: string;
  items: { value: T; label: string; count?: number; icon?: React.ElementType; danger?: boolean }[];
}) => (
  <div className="sgui-tabs" role="tablist" aria-label={label}>
    {items.map(({ value: v, label: l, count, icon: Icon, danger }) => (
      <button key={v} type="button" role="tab" aria-selected={value === v} className={`${value === v ? 'is-active' : ''} ${danger ? 'is-danger' : ''}`} onClick={() => onChange(v)}>
        {Icon && <Icon size={16} aria-hidden="true" />}
        <span>{l}</span>
        {count !== undefined && <span className="sgui-count">{count}</span>}
      </button>
    ))}
  </div>
);

export const EmptyState: React.FC<{ icon?: React.ElementType; children: React.ReactNode }> = ({ icon: Icon, children }) => (
  <div className="sgui-empty">
    {Icon && <Icon size={28} aria-hidden="true" />}
    <div>{children}</div>
  </div>
);

export const LoadingState: React.FC<{ label?: string }> = ({ label = 'جاري التحميل...' }) => (
  <div className="sgui-loading" role="status"><span aria-hidden="true"></span>{label}</div>
);
