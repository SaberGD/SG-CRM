export function normalizePhoneKey(phone: unknown): string;
export function normalizeName(name: unknown): string;
export interface MergePlan { ok: boolean; reason?: string; primaryId?: string; duplicateIds?: string[]; patch?: Record<string, unknown>; }
export function planMerge(group: any[], ctx?: { followupCounts?: Record<string, number>; poolAgentIds?: Set<string> }): MergePlan;
