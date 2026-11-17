// Egyptian governorates, offered as suggestions for the client's governorate field.
// The field stays free text so a client outside Egypt can have their own region typed in.
export const EGYPT_GOVERNORATES = [
  'القاهرة', 'الجيزة', 'الإسكندرية', 'القليوبية', 'الدقهلية', 'الشرقية', 'الغربية', 'المنوفية', 'البحيرة',
  'كفر الشيخ', 'دمياط', 'بورسعيد', 'الإسماعيلية', 'السويس', 'الفيوم', 'بني سويف', 'المنيا', 'أسيوط',
  'سوهاج', 'قنا', 'الأقصر', 'أسوان', 'البحر الأحمر', 'الوادي الجديد', 'مطروح', 'شمال سيناء', 'جنوب سيناء',
];

/** "المحافظة · المدينة", or whichever of the two is known; '' when neither is. */
export const clientLocationLabel = (c: { governorate?: string; city?: string } | null | undefined): string =>
  [c?.governorate, c?.city].map(v => String(v || '').trim()).filter(Boolean).join(' · ');
