// One phone helper for the web app. The lookup key (last 10 digits) is the same one the
// Cloud Functions, the accounting sync and the merge script use (utils/clientMerge.mjs).
import { normalizePhoneKey } from './clientMerge.mjs';
import { buildSearchKeys } from './searchKeys.mjs';

export { normalizePhoneKey };

/** "+20 10..." / "010..." / "2010..." -> "+2010..." (E.164). Unknown shapes keep their digits with a "+". */
export function toE164(raw: unknown, countryCode = '+20'): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (s.startsWith('+')) return '+' + digits;
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  const cc = String(countryCode || '+20').replace(/\D/g, '');
  if (digits.startsWith(cc) && digits.length > cc.length + 7) return '+' + digits;
  return '+' + cc + digits.replace(/^0+/, '');
}

/** Keys every client write must carry so search and the accounting sync find it. */
export function clientIdentityKeys(name: unknown, phone: unknown) {
  const phoneKey = normalizePhoneKey(phone);
  return {
    searchKeys: buildSearchKeys(String(name || ''), String(phone || '')),
    phoneKey,
    phoneKeys: phoneKey ? [phoneKey] : [],
  };
}

export const telHref = (phone: unknown, countryCode?: string) => {
  const e = toE164(phone, countryCode);
  return e ? `tel:${e}` : '';
};

export const whatsappHref = (phone: unknown, countryCode?: string) => {
  const e = toE164(phone, countryCode);
  return e ? `https://wa.me/${e.slice(1)}` : '';
};
