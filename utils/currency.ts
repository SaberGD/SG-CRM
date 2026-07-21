export const FALLBACK_EXCHANGE_RATES: Record<string, number> = {
  USD: 48.50,
  EUR: 52.80,
  SAR: 12.93,
  AED: 13.20,
  KWD: 157.50,
  QAR: 13.32,
  OMR: 126.00,
  BHD: 128.60,
  EGP: 1.0,
};

export const CURRENCY_LABELS: Record<string, { ar: string; symbol: string }> = {
  USD: { ar: 'دولار أمريكي', symbol: '$' },
  EUR: { ar: 'يورو', symbol: '€' },
  SAR: { ar: 'ريال سعودي', symbol: 'ر.س' },
  AED: { ar: 'درهم إماراتي', symbol: 'د.إ' },
  KWD: { ar: 'دينار كويتي', symbol: 'د.ك' },
  QAR: { ar: 'ريال قطري', symbol: 'ر.ق' },
  OMR: { ar: 'ريال عماني', symbol: 'ر.ع.' },
  BHD: { ar: 'دينار بحريني', symbol: 'د.ب' },
  EGP: { ar: 'جنيه مصري', symbol: 'ج.م' },
};

export interface ConvertedResult {
  exchangeRate: number;
  convertedTotal: number;
  convertedPaid: number;
  deductionTotal: number;
  deductionPaid: number;
  finalTotal: number;
  finalPaid: number;
  finalRemaining: number;
  deductionReason: string;
}

export const fetchExchangeRates = async (): Promise<Record<string, number>> => {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error('Exchange rate network request failed');
    const data = await res.json();
    const rates = data.rates;
    if (rates && rates.EGP) {
      const egpRate = rates.EGP;
      const calculatedRates: Record<string, number> = { EGP: 1.0 };
      Object.keys(FALLBACK_EXCHANGE_RATES).forEach(cur => {
        if (cur === 'EGP') return;
        if (rates[cur]) {
          calculatedRates[cur] = parseFloat((egpRate / rates[cur]).toFixed(4));
        } else {
          calculatedRates[cur] = FALLBACK_EXCHANGE_RATES[cur];
        }
      });
      return calculatedRates;
    }
  } catch (err) {
    console.warn("Failed to fetch live exchange rates, using fallbacks:", err);
  }
  return FALLBACK_EXCHANGE_RATES;
};

export const calculateExternalTransfer = (
  totalInCurrency: number,
  paidInCurrency: number,
  currency: string,
  exchangeRate: number
): ConvertedResult => {
  const convertedTotal = parseFloat((totalInCurrency * exchangeRate).toFixed(2));
  const convertedPaid = parseFloat((paidInCurrency * exchangeRate).toFixed(2));
  
  // Deduct 17% (3% transfer + 14% tax)
  const deductionTotal = parseFloat((convertedTotal * 0.17).toFixed(2));
  const deductionPaid = parseFloat((convertedPaid * 0.17).toFixed(2));
  
  const finalTotal = parseFloat((convertedTotal - deductionTotal).toFixed(2));
  const finalPaid = parseFloat((convertedPaid - deductionPaid).toFixed(2));
  const finalRemaining = parseFloat((finalTotal - finalPaid).toFixed(2));
  
  return {
    exchangeRate,
    convertedTotal,
    convertedPaid,
    deductionTotal,
    deductionPaid,
    finalTotal,
    finalPaid,
    finalRemaining,
    deductionReason: '٣٪ عمولة تحويل و ١٤٪ ضرايب',
  };
};
