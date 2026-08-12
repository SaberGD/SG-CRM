import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { Client, ClientStatus, SourceLabels, Gender } from '../types';

export const exportBookingsToExcel = (clients: Client[], fileName: string = 'تقرير_الحجوزات.xlsx') => {
  // Filter for clients who are booked or export all provided clients
  const exportData = clients.map(client => {
    return {
      'name': client.name || '',
      'phone': client.phone || '',
      'salesAgentName': client.salesAgentName || '',
      'gender': client.gender === Gender.FEMALE ? 'أنثى' : 'ذكر',
      'source': SourceLabels[client.source || 'OTHER']?.ar || client.source || 'أخرى',
      'profileLink': client.profileLink || '',
      'status': client.status || ClientStatus.BOOKED,
      'bookedCourseName': client.bookedCourseName || '',
      'totalPrice': client.totalPrice || 0,
      'paidAmount': client.paidAmount || 0,
      'bookingDate': client.bookingDate ? new Date(client.bookingDate).toISOString().split('T')[0] : '',
      'isExternalTransfer': client.isExternalTransfer ? 'true' : 'false',
      'originalCurrency': client.originalCurrency || '',
      'originalTotalPrice': client.originalTotalPrice || '',
      'originalPaidAmount': client.originalPaidAmount || '',
      'exchangeRateUsed': client.exchangeRateUsed || ''
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'الحجوزات');

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8' });
  saveAs(blob, fileName);
};
