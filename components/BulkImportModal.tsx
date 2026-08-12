import React, { useState } from 'react';
import * as firestore from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { Client, ClientStatus, ClientSource, Gender } from '../types';
import { X, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, RefreshCw, FileDown, ArrowRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: { uid: string; name: string };
  salesAgents: { id: string; name: string }[];
  services: { id: string; name: string }[];
  onSuccess: () => void;
}

interface ParsedRow {
  rowIndex: number;
  name: string;
  phone: string;
  salesAgentName?: string;
  salesAgentId?: string;
  gender?: Gender;
  source?: ClientSource;
  profileLink?: string;
  bookedCourseName: string;
  bookedCourseId?: string;
  totalPrice: number;
  paidAmount: number;
  remainingAmount: number;
  bookingDate?: string;
  isExternalTransfer?: boolean;
  originalCurrency?: string;
  originalTotalPrice?: number;
  originalPaidAmount?: number;
  exchangeRateUsed?: number;
  
  // Validation status
  isValid: boolean;
  errorMessage?: string;
  isExistingClient?: boolean;
  existingClientId?: string;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  salesAgents,
  services,
  onSuccess,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStats, setImportStats] = useState<{ updated: number; created: number } | null>(null);

  if (!isOpen) return null;

  // Helper to normalize phone number for reliable matching
  const normalizePhone = (phoneStr: string | number | undefined): string => {
    if (!phoneStr) return '';
    let str = String(phoneStr).trim().replace(/[\s\-\(\)]/g, '');
    if (str.startsWith('00')) {
      str = '+' + str.slice(2);
    }
    return str;
  };

  // Generate Sample Excel File
  const downloadSampleTemplate = () => {
    const sampleData = [
      {
        'name': 'أحمد محمد علي',
        'phone': '01012345678',
        'salesAgentName': salesAgents[0]?.name || currentUser.name,
        'gender': 'ذكر',
        'source': 'WHATSAPP',
        'profileLink': 'https://facebook.com/example',
        'bookedCourseName': services[0]?.name || 'دورة البرمجة الشاملة',
        'totalPrice': 5000,
        'paidAmount': 3000,
        'bookingDate': '2024-08-12',
        'isExternalTransfer': 'false',
        'originalCurrency': '',
        'originalTotalPrice': '',
        'originalPaidAmount': '',
        'exchangeRateUsed': ''
      },
      {
        'name': 'سارة إبراهيم الخالد',
        'phone': '+966501234567',
        'salesAgentName': salesAgents[0]?.name || currentUser.name,
        'gender': 'أنثى',
        'source': 'INSTAGRAM',
        'profileLink': '',
        'bookedCourseName': services[0]?.name || 'دورة التصميم الجرافيكي',
        'totalPrice': 9700,
        'paidAmount': 9700,
        'bookingDate': '2024-08-10',
        'isExternalTransfer': 'true',
        'originalCurrency': 'SAR',
        'originalTotalPrice': 200,
        'originalPaidAmount': 200,
        'exchangeRateUsed': 48.5
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'نموذج_الحجوزات');
    
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8' });
    saveAs(blob, 'نموذج_استيراد_الحجوزات.xlsx');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setIsAnalyzing(true);
    setImportStats(null);

    try {
      const data = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (jsonRows.length === 0) {
        alert('الملف المرفوع فارغ أو لا يحتوي على بيانات صالحة.');
        setIsAnalyzing(false);
        return;
      }

      // Fetch existing clients from Firestore to perform matching by phone
      const clientsSnap = await firestore.getDocs(firestore.collection(db, 'clients'));
      const existingClientsMap = new Map<string, string>(); // phone -> docId
      clientsSnap.docs.forEach(doc => {
        const c = doc.data();
        const p = normalizePhone(c.phone);
        if (p) {
          existingClientsMap.set(p, doc.id);
          // Also map without country code if Egyptian (01xxx)
          if (p.startsWith('+20') && p.length === 13) {
            existingClientsMap.set('0' + p.slice(3), doc.id);
          } else if (p.startsWith('01') && p.length === 11) {
            existingClientsMap.set('+20' + p.slice(1), doc.id);
          }
        }
      });

      const parsed: ParsedRow[] = [];

      jsonRows.forEach((row, index) => {
        // Flexible key matching for Arabic / English column names
        const getKey = (keys: string[]) => {
          for (const k of keys) {
            if (row[k] !== undefined && row[k] !== '') return row[k];
            // case-insensitive check
            const foundKey = Object.keys(row).find(rk => rk.trim().toLowerCase() === k.toLowerCase());
            if (foundKey && row[foundKey] !== undefined && row[foundKey] !== '') return row[foundKey];
          }
          return '';
        };

        const rawName = String(getKey(['name', 'الاسم', 'اسم العميل', 'Full Name'])).trim();
        const rawPhone = String(getKey(['phone', 'الهاتف', 'رقم الهاتف', 'رقم الموبايل', 'Phone Number'])).trim();
        const rawAgentName = String(getKey(['salesAgentName', 'اسم مسؤول المبيعات', 'المبيعات', 'Sales Agent'])).trim();
        const rawGender = String(getKey(['gender', 'الجنس', 'النوع'])).trim();
        const rawSource = String(getKey(['source', 'المصدر', 'مصدر العميل'])).trim();
        const rawProfile = String(getKey(['profileLink', 'رابط البروفايل', 'Profile Link'])).trim();
        const rawCourseName = String(getKey(['bookedCourseName', 'اسم الكورس أو الخدمة', 'الكورس المحجوز', 'الكورس', 'الخدمة'])).trim();
        
        const rawTotal = parseFloat(getKey(['totalPrice', 'السعر الإجمالي', 'المبلغ الإجمالي', 'الإجمالي', 'Total Price'])) || 0;
        const rawPaid = parseFloat(getKey(['paidAmount', 'المبلغ المدفوع', 'المدفوع', 'Paid Amount'])) || 0;
        const rawBookingDate = String(getKey(['bookingDate', 'تاريخ الحجز', 'Booking Date'])).trim();

        const rawIsExt = String(getKey(['isExternalTransfer', 'تحويل خارجي', 'من خارج مصر'])).trim();
        const isExternal = rawIsExt === 'true' || rawIsExt === '1' || rawIsExt.includes('نعم') || rawIsExt.includes('خارجي');

        const rawCurrency = String(getKey(['originalCurrency', 'العملة الأصلية', 'العملة'])).trim() || 'USD';
        const rawOrigTotal = parseFloat(getKey(['originalTotalPrice', 'الإجمالي بالعملة الأجنبية', 'origTotal'])) || 0;
        const rawOrigPaid = parseFloat(getKey(['originalPaidAmount', 'المدفوع بالعملة الأجنبية', 'origPaid'])) || 0;
        const rawRate = parseFloat(getKey(['exchangeRateUsed', 'سعر الصرف', 'exchangeRate'])) || 48.5;

        const normalizedP = normalizePhone(rawPhone);
        const existingDocId = normalizedP ? existingClientsMap.get(normalizedP) : undefined;

        // Validation checks
        let isValid = true;
        let errorMessage = '';

        if (!rawName) {
          isValid = false;
          errorMessage = 'اسم العميل مفقود';
        } else if (!rawPhone) {
          isValid = false;
          errorMessage = 'رقم الهاتف مفقود';
        } else if (!rawCourseName) {
          isValid = false;
          errorMessage = 'اسم الكورس أو الخدمة مفقود';
        }

        // Match Agent
        let agentId = currentUser.uid;
        let agentName = currentUser.name;
        if (rawAgentName) {
          const matchedAgent = salesAgents.find(a => 
            a.name.trim().toLowerCase() === rawAgentName.toLowerCase() ||
            rawAgentName.toLowerCase().includes(a.name.trim().toLowerCase())
          );
          if (matchedAgent) {
            agentId = matchedAgent.id;
            agentName = matchedAgent.name;
          }
        }

        // Match Course/Service ID if possible
        let matchedService = services.find(s => 
          s.name.trim().toLowerCase() === rawCourseName.toLowerCase() ||
          rawCourseName.toLowerCase().includes(s.name.trim().toLowerCase())
        );

        // Normalize Gender
        let parsedGender: Gender = Gender.MALE;
        if (rawGender.includes('أنثى') || rawGender.toLowerCase() === 'female' || rawGender.toLowerCase() === 'f') {
          parsedGender = Gender.FEMALE;
        }

        // Normalize Source
        let parsedSource: ClientSource = ClientSource.OTHER;
        const sLower = rawSource.toLowerCase();
        if (sLower.includes('face') || sLower.includes('فيسبوك')) parsedSource = ClientSource.FACEBOOK;
        else if (sLower.includes('insta') || sLower.includes('انستجرام')) parsedSource = ClientSource.INSTAGRAM;
        else if (sLower.includes('whats') || sLower.includes('واتساب')) parsedSource = ClientSource.WHATSAPP;
        else if (sLower.includes('web') || sLower.includes('موقع') || sLower.includes('google')) parsedSource = ClientSource.GOOGLE;
        else if (sLower.includes('tik') || sLower.includes('تيك')) parsedSource = ClientSource.TIKTOK;

        parsed.push({
          rowIndex: index + 2, // header is row 1
          name: rawName,
          phone: rawPhone,
          salesAgentName: agentName,
          salesAgentId: agentId,
          gender: parsedGender,
          source: parsedSource,
          profileLink: rawProfile,
          bookedCourseName: matchedService ? matchedService.name : rawCourseName,
          bookedCourseId: matchedService ? matchedService.id : 'custom',
          totalPrice: rawTotal,
          paidAmount: rawPaid,
          remainingAmount: Math.max(0, rawTotal - rawPaid),
          bookingDate: rawBookingDate,
          isExternalTransfer: isExternal,
          originalCurrency: rawCurrency,
          originalTotalPrice: rawOrigTotal,
          originalPaidAmount: rawOrigPaid,
          exchangeRateUsed: rawRate,
          isValid,
          errorMessage,
          isExistingClient: !!existingDocId,
          existingClientId: existingDocId
        });
      });

      setParsedRows(parsed);
    } catch (err) {
      console.error('Error reading excel/csv file:', err);
      alert('حدث خطأ أثناء قراءة الملف. يرجى التأكد من أن صيغة الملف صالحة (XLSX أو CSV).');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const executeBulkImport = async () => {
    const validRows = parsedRows.filter(r => r.isValid);
    if (validRows.length === 0) {
      alert('لا توجد صفوف صالحة للاستيراد في الملف.');
      return;
    }

    setIsImporting(true);
    setImportProgress(0);

    let updatedCount = 0;
    let createdCount = 0;

    try {
      const chunkSize = 200; // Batch limit safe size
      const total = validRows.length;

      for (let i = 0; i < total; i += chunkSize) {
        const chunk = validRows.slice(i, i + chunkSize);
        const batch = firestore.writeBatch(db);

        for (const row of chunk) {
          const nowTs = Date.now();
          const bookingTimestamp = row.bookingDate ? new Date(row.bookingDate).getTime() || nowTs : nowTs;

          // Deductions for external transfer
          let deductionAmount = 0;
          let deductionReason = '';
          if (row.isExternalTransfer) {
            deductionAmount = parseFloat((row.paidAmount * 0.17).toFixed(2));
            deductionReason = '٣٪ عمولة تحويل و ١٤٪ ضرايب';
          }

          if (row.isExistingClient && row.existingClientId) {
            // UPDATE EXISTING CLIENT -> Change status to BOOKED and attach booking details
            const clientRef = firestore.doc(db, 'clients', row.existingClientId);
            batch.update(clientRef, {
              status: ClientStatus.BOOKED,
              isBooked: true,
              bookedCourseId: row.bookedCourseId || 'custom',
              bookedCourseName: row.bookedCourseName,
              totalPrice: row.totalPrice,
              paidAmount: row.paidAmount,
              remainingAmount: row.remainingAmount,
              bookingDate: bookingTimestamp,
              isExternalTransfer: !!row.isExternalTransfer,
              originalCurrency: row.originalCurrency || 'USD',
              originalTotalPrice: row.originalTotalPrice || 0,
              originalPaidAmount: row.originalPaidAmount || 0,
              exchangeRateUsed: row.exchangeRateUsed || 48.5,
              deductionAmount,
              deductionReason
            });
            updatedCount++;
          } else {
            // CREATE NEW CLIENT WITH BOOKED STATUS
            const newDocRef = firestore.doc(firestore.collection(db, 'clients'));
            const clientData: Partial<Client> = {
              name: row.name,
              phone: row.phone,
              gender: row.gender || Gender.MALE,
              source: row.source || ClientSource.OTHER,
              profileLink: row.profileLink || '',
              status: ClientStatus.BOOKED,
              salesAgentId: row.salesAgentId || currentUser.uid,
              salesAgentName: row.salesAgentName || currentUser.name,
              createdAt: nowTs,
              country: 'مصر',
              isBooked: true,
              bookedCourseId: row.bookedCourseId || 'custom',
              bookedCourseName: row.bookedCourseName,
              totalPrice: row.totalPrice,
              paidAmount: row.paidAmount,
              remainingAmount: row.remainingAmount,
              bookingDate: bookingTimestamp,
              isExternalTransfer: !!row.isExternalTransfer,
              originalCurrency: row.originalCurrency || 'USD',
              originalTotalPrice: row.originalTotalPrice || 0,
              originalPaidAmount: row.originalPaidAmount || 0,
              exchangeRateUsed: row.exchangeRateUsed || 48.5,
              deductionAmount,
              deductionReason,
              transferHistory: []
            };
            batch.set(newDocRef, clientData);
            createdCount++;
          }
        }

        await batch.commit();
        setImportProgress(Math.round(((i + chunk.length) / total) * 100));
      }

      await logActivity(
        currentUser.uid, 
        currentUser.name, 
        `استيراد جماعي لـ ${validRows.length} حجز (تحديث: ${updatedCount} - جديد: ${createdCount})`,
        'BULK_IMPORT',
        `تم الاستيراد بنجاح من ملف ${file?.name || ''}`
      );

      setImportStats({ updated: updatedCount, created: createdCount });
      setTimeout(() => {
        onSuccess();
      }, 1000);

    } catch (err) {
      console.error('Error executing bulk import:', err);
      alert('حدث خطأ أثناء حفظ البيانات في السيستم. يرجى إعادة المحاولة.');
    } finally {
      setIsImporting(false);
    }
  };

  const validCount = parsedRows.filter(r => r.isValid).length;
  const invalidCount = parsedRows.filter(r => !r.isValid).length;
  const existingCount = parsedRows.filter(r => r.isValid && r.isExistingClient).length;
  const newCount = parsedRows.filter(r => r.isValid && !r.isExistingClient).length;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 dir-rtl">
      <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col my-auto max-h-[90vh]">
        
        {/* Header */}
        <div className="p-8 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 text-amber-600 rounded-2xl">
              <FileSpreadsheet size={28} />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white">الاستيراد الجماعي للحجوزات (Bulk Import)</h3>
              <p className="text-xs font-bold text-slate-500">رفع وحفظ العملاء والحجوزات دفعة واحدة من ملف Excel أو CSV</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-2xl bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:opacity-80 transition">
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-8 space-y-6 overflow-y-auto flex-1">
          
          {/* Controls & Sample Download */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 bg-amber-50 dark:bg-amber-500/5 rounded-3xl border border-amber-200 dark:border-amber-500/10 space-y-3">
              <h4 className="font-black text-sm text-amber-800 dark:text-amber-400 flex items-center gap-2">
                <FileDown size={18} /> تحميل النموذج الإسترشادي
              </h4>
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80 font-bold leading-relaxed">
                قم بتحميل ملف Excel المصمم بالعمود الصحيحة بالكامل، لتعبئة بيانات العملاء والحجوزات وفق المخطط المطلوب.
              </p>
              <button 
                onClick={downloadSampleTemplate} 
                className="bg-amber-600 text-white px-5 py-2.5 rounded-2xl font-black text-xs hover:bg-amber-700 transition flex items-center gap-2"
              >
                <FileDown size={16} /> تحميل ملف XLSX كـ Template
              </button>
            </div>

            {/* Upload Box */}
            <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center text-center space-y-3">
              <Upload className="text-primary-500" size={32} />
              <div>
                <p className="text-xs font-black text-slate-900 dark:text-white">اختر ملف Excel أو CSV من جهازك</p>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5">يدعم صيغ .xlsx و .xls و .csv</p>
              </div>
              <input 
                type="file" 
                accept=".xlsx, .xls, .csv" 
                onChange={handleFileUpload} 
                className="hidden" 
                id="bulk-import-file-input"
              />
              <label 
                htmlFor="bulk-import-file-input" 
                className="cursor-pointer bg-primary-500 text-white px-6 py-2.5 rounded-2xl font-black text-xs hover:bg-primary-600 transition"
              >
                {file ? file.name : 'رفع الملف الآن'}
              </label>
            </div>
          </div>

          {/* Processing / Progress State */}
          {isAnalyzing && (
            <div className="p-8 text-center space-y-3 bg-slate-50 dark:bg-slate-800/30 rounded-3xl">
              <RefreshCw className="animate-spin text-primary-500 mx-auto" size={32} />
              <p className="text-sm font-black text-slate-700 dark:text-slate-200">جاري فحص الملف ومطابقة أرقام الهواتف مع السيستم...</p>
            </div>
          )}

          {/* Stats Summary after Analysis */}
          {parsedRows.length > 0 && !isAnalyzing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-2xl text-center">
                  <p className="text-[10px] font-black text-slate-400 uppercase">إجمالي الصفوف</p>
                  <p className="text-xl font-black text-slate-800 dark:text-white">{parsedRows.length}</p>
                </div>
                <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl text-center">
                  <p className="text-[10px] font-black text-emerald-600 uppercase">جاهز للاستيراد</p>
                  <p className="text-xl font-black text-emerald-600">{validCount}</p>
                </div>
                <div className="p-4 bg-sky-50 dark:bg-sky-500/10 rounded-2xl text-center">
                  <p className="text-[10px] font-black text-sky-600 uppercase">تحديث عملاء سابقيين</p>
                  <p className="text-xl font-black text-sky-600">{existingCount}</p>
                  <span className="text-[9px] font-bold text-sky-500">حفظ كـ حجز بالفعل دون تكرار</span>
                </div>
                <div className="p-4 bg-indigo-50 dark:bg-indigo-500/10 rounded-2xl text-center">
                  <p className="text-[10px] font-black text-indigo-600 uppercase">عملاء جُدد بالحجز</p>
                  <p className="text-xl font-black text-indigo-600">{newCount}</p>
                </div>
              </div>

              {/* Preview Table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-500 font-black sticky top-0">
                    <tr>
                      <th className="p-3">#</th>
                      <th className="p-3">اسم العميل</th>
                      <th className="p-3">رقم الهاتف</th>
                      <th className="p-3">الكورس المحجوز</th>
                      <th className="p-3">المبلغ المدفوع</th>
                      <th className="p-3">المبيعات</th>
                      <th className="p-3">الإجراء بالسيستم</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {parsedRows.map((row, idx) => (
                      <tr key={idx} className={!row.isValid ? 'bg-rose-50/50 dark:bg-rose-950/20' : ''}>
                        <td className="p-3 font-bold text-slate-400">{row.rowIndex}</td>
                        <td className="p-3 font-black text-slate-900 dark:text-white">{row.name || '—'}</td>
                        <td className="p-3 font-bold text-slate-600 dark:text-slate-300" dir="ltr">{row.phone || '—'}</td>
                        <td className="p-3 font-bold text-slate-700 dark:text-slate-300">{row.bookedCourseName}</td>
                        <td className="p-3 font-black text-emerald-600">{row.paidAmount} ج.م</td>
                        <td className="p-3 font-bold text-slate-500">{row.salesAgentName}</td>
                        <td className="p-3 font-bold">
                          {!row.isValid ? (
                            <span className="text-rose-500 flex items-center gap-1">
                              <AlertCircle size={14} /> {row.errorMessage}
                            </span>
                          ) : row.isExistingClient ? (
                            <span className="text-sky-600 bg-sky-50 dark:bg-sky-500/10 px-2 py-0.5 rounded font-black text-[10px]">
                              تحديث حجز العميل السجل
                            </span>
                          ) : (
                            <span className="text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded font-black text-[10px]">
                              إنشاء عميل وحجز جديد
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Import Progress Bar */}
          {isImporting && (
            <div className="space-y-2 p-6 bg-amber-500/10 rounded-3xl border border-amber-500/20 text-center">
              <p className="text-sm font-black text-amber-700 dark:text-amber-300">جاري نقل البيانات وحفظ الحجوزات في قواعد البيانات ({importProgress}%)...</p>
              <div className="w-full bg-slate-200 dark:bg-slate-700 h-3 rounded-full overflow-hidden">
                <div className="bg-amber-500 h-full transition-all duration-300" style={{ width: `${importProgress}%` }}></div>
              </div>
            </div>
          )}

          {/* Final Stats Success Message */}
          {importStats && (
            <div className="p-6 bg-emerald-50 dark:bg-emerald-500/10 rounded-3xl border border-emerald-500/20 text-center space-y-2">
              <CheckCircle2 className="text-emerald-500 mx-auto" size={36} />
              <h4 className="font-black text-lg text-emerald-700 dark:text-emerald-400">تم الاستيراد بنجاح!</h4>
              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-300">
                تم تحديث حالة ({importStats.updated}) عميل سابق إلى "حجز بالفعل" + إنشاء ({importStats.created}) عميل جديد بحجزهم.
              </p>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
          <button 
            onClick={onClose} 
            disabled={isImporting}
            className="px-6 py-3 bg-slate-200 dark:bg-slate-700 font-bold text-xs rounded-2xl text-slate-700 dark:text-slate-200 hover:opacity-80 transition"
          >
            إلغاء
          </button>
          
          <button 
            onClick={executeBulkImport} 
            disabled={isImporting || validCount === 0}
            className="px-8 py-3.5 bg-primary-500 text-white font-black text-xs rounded-2xl hover:bg-primary-600 transition disabled:opacity-50 flex items-center gap-2 shadow-lg"
          >
            <ArrowRight size={18} />
            تأكيد واستيراد ({validCount}) حجز الآن
          </button>
        </div>

      </div>
    </div>
  );
};
