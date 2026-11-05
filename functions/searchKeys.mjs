// Indexed search keys for clients (shared by the web app, scripts and Cloud Functions).
// A client is findable by the start of ANY word of its name (Arabic spelling variants
// unified) and by the last 4-10 digits of its phone. One array-contains query = one index.

export const normalizeText = (s) => String(s || '')
  .replace(/[ً-ْـٰ]/g, '')   // harakat, tatweel
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const MAX_PREFIX = 15;

export function buildSearchKeys(name, phone) {
  const keys = new Set();
  for (const word of normalizeText(name).split(' ')) {
    // by code point, so decorative/emoji letters (surrogate pairs) are never cut in half
    const chars = [...word];
    if (chars.length < 2) continue;
    for (let i = 2; i <= Math.min(chars.length, MAX_PREFIX); i++) keys.add(chars.slice(0, i).join(''));
  }
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 4) for (let n = 4; n <= Math.min(10, digits.length); n++) keys.add(digits.slice(-n));
  return [...keys].sort();
}

// What to look up for a typed search: digits -> phone tail; text -> the longest word typed.
export function searchTerm(input) {
  const raw = String(input || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 4 && digits.length >= raw.replace(/\s/g, '').length - 1) return digits.slice(-10);
  const words = normalizeText(raw).split(' ').filter((w) => [...w].length >= 2);
  if (!words.length) return '';
  return [...words.sort((a, b) => [...b].length - [...a].length)[0]].slice(0, MAX_PREFIX).join('');
}

// Client-side refinement after the indexed query: every typed word must match a word start.
export function matchesSearch(client, input) {
  const raw = String(input || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 4 && digits.length >= raw.replace(/\s/g, '').length - 1) return String(client.phone || '').replace(/\D/g, '').endsWith(digits.slice(-10));
  const words = normalizeText(client.name).split(' ');
  return normalizeText(raw).split(' ').filter(Boolean).every((t) => words.some((w) => w.startsWith(t)));
}
