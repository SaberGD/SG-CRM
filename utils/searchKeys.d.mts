export function normalizeText(s: unknown): string;
export function buildSearchKeys(name: unknown, phone: unknown): string[];
export function searchTerm(input: unknown): string;
export function matchesSearch(client: { name?: string; phone?: string }, input: unknown): boolean;
