import type { CSSProperties } from 'react';

export const LABEL_COLOR_OPTIONS = [
  { name: 'أزرق', value: '#2563eb' },
  { name: 'سماوي', value: '#0891b2' },
  { name: 'أخضر', value: '#059669' },
  { name: 'ليموني', value: '#65a30d' },
  { name: 'أصفر', value: '#d97706' },
  { name: 'برتقالي', value: '#ea580c' },
  { name: 'أحمر', value: '#dc2626' },
  { name: 'وردي', value: '#db2777' },
  { name: 'بنفسجي', value: '#7c3aed' },
  { name: 'نيلي', value: '#4f46e5' },
  { name: 'رمادي', value: '#475569' },
  { name: 'أسود', value: '#111827' },
];

const LEGACY_TAILWIND_COLORS: Record<string, string> = {
  'bg-blue-500': '#3b82f6',
  'bg-emerald-500': '#10b981',
  'bg-rose-500': '#f43f5e',
  'bg-amber-500': '#f59e0b',
  'bg-purple-500': '#a855f7',
  'bg-pink-500': '#ec4899',
  'bg-indigo-500': '#6366f1',
  'bg-slate-500': '#64748b',
};

export const normalizeLabelColor = (color?: string) => {
  if (!color) return LABEL_COLOR_OPTIONS[0].value;
  return LEGACY_TAILWIND_COLORS[color] || color;
};

export const getLabelColorStyle = (color?: string, selected = true): CSSProperties => {
  const normalizedColor = normalizeLabelColor(color);

  return {
    backgroundColor: selected ? normalizedColor : 'transparent',
    borderColor: normalizedColor,
    color: selected ? '#fff' : normalizedColor,
  };
};
