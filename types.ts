import type { AutoFollowUpState } from './utils/autoFollowUp';


export enum UserRole {
  ADMIN = 'admin',
  SUPERVISOR = 'supervisor',
  MANAGER = 'manager',
  TEAM_LEADER = 'team_leader',
  SALES_AGENT = 'sales_agent'
}

export enum ClientStatus {
  INTERESTED = 'interested',
  NOT_INTERESTED = 'not_interested',
  POTENTIAL = 'potential',
  BOOKED = 'booked'
}

export enum CommMethod {
  PHONE = 'phone',
  WHATSAPP = 'whatsapp',
  MEETING = 'meeting',
  OTHER = 'other'
}

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  UNSPECIFIED = 'unspecified'
}

export enum LaptopStatus {
  WITH = 'with',
  WITHOUT = 'without',
  UNSPECIFIED = 'unspecified'
}

export enum ClientSource {
  WHATSAPP = 'whatsapp',
  MESSENGER = 'messenger',
  FACEBOOK = 'facebook',
  INSTAGRAM = 'instagram',
  TIKTOK = 'tiktok',
  GOOGLE = 'google',
  OTHER = 'other'
}

export enum AttendanceMode {
  ONLINE = 'online',
  OFFLINE = 'offline',
  UNSPECIFIED = 'unspecified'
}

export const StatusLabels: Record<ClientStatus, { en: string, ar: string, color: string }> = {
  [ClientStatus.INTERESTED]: { en: 'Interested', ar: 'مهتم', color: 'bg-emerald-50 text-emerald-600' },
  [ClientStatus.NOT_INTERESTED]: { en: 'Not Interested', ar: 'غير مهتم', color: 'bg-rose-50 text-rose-600' },
  [ClientStatus.POTENTIAL]: { en: 'Potential', ar: 'محتمل', color: 'bg-blue-50 text-blue-600' },
  [ClientStatus.BOOKED]: { en: 'Booked', ar: 'حجز بالفعل', color: 'bg-amber-50 text-amber-600' }
};

export const CommMethodLabels: Record<CommMethod, { ar: string }> = {
  [CommMethod.PHONE]: { ar: 'اتصال هاتفي' },
  [CommMethod.WHATSAPP]: { ar: 'واتساب' },
  [CommMethod.MEETING]: { ar: 'مقابلة في المقر' },
  [CommMethod.OTHER]: { ar: 'أخرى' }
};

export const SourceLabels: Record<ClientSource, { ar: string }> = {
  [ClientSource.WHATSAPP]: { ar: 'واتساب' },
  [ClientSource.MESSENGER]: { ar: 'ماسينجر' },
  [ClientSource.FACEBOOK]: { ar: 'فيسبوك' },
  [ClientSource.INSTAGRAM]: { ar: 'انستجرام' },
  [ClientSource.TIKTOK]: { ar: 'تيك توك' },
  [ClientSource.GOOGLE]: { ar: 'جوجل' },
  [ClientSource.OTHER]: { ar: 'أخرى' }
};

export interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  isActive: boolean;
}

export interface Label {
  id: string;
  text: string;
  color: string;
}

export interface User {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  teamId?: string;
  createdAt?: number;
  invitedBy?: string;
  isDeactivated?: boolean;
  deactivatedAt?: number;
}

export interface Invitation {
  id: string;
  email: string;
  role: UserRole;
  status: 'pending' | 'used' | 'expired';
  invitedBy: string;
  invitedByName: string;
  timestamp: number;
}

export interface AiRecommendation {
  suggestedDate: string; // YYYY-MM-DD
  suggestedTime?: string; // HH:MM
  suggestedTimestamp: number;
  suggestedChannel: string;
  suggestedPitch: string;
  conversionPriority: 'عالي' | 'متوسط' | 'منخفض';
  insightsSummary: string;
  salesTip: string;
  generatedAt: number;
  status: 'PENDING' | 'ACCEPTED' | 'SKIPPED' | 'DISMISSED';
  round?: number;
  acceptedAt?: number;
  acceptedByUid?: string;
  acceptedByName?: string;
  salesComment?: string;
  salesCheckAt?: number;
  supervisorCheck?: boolean;
  supervisorCheckedAt?: number;
  supervisorCheckedByName?: string;
  supervisorNotes?: string;
}

export interface Client {
  id: string;
  name: string;
  position?: string;
  phone: string;
  gender: Gender;
  laptop: LaptopStatus;
  mode: AttendanceMode;
  status: ClientStatus;
  serviceId: string;
  serviceName: string;
  labels: string[];
  salesAgentId: string;
  salesAgentName: string;
  createdAt: number;
  lastFollowUpDate?: number;
  nextFollowUpDate?: number;
  nextFollowUpMethod?: CommMethod;
  // 'auto_booked' is LEGACY: the first release kept the 2-week check-in here; it now lives in
  // nextCheckInDate (see utils/autoFollowUp.ts, scripts/migrate-checkins.cjs).
  nextFollowUpSetVia?: 'ai_automation' | 'manual' | 'auto_booked';
  nextFollowUpReason?: string;
  nextFollowUpReviewedBySales?: boolean;
  nextFollowUpReviewedByName?: string;
  nextFollowUpReviewedAt?: number;
  notes?: string;
  preferredMethod?: CommMethod;
  country: string;
  countryCode: string;
  // Booking Fields
  isBooked?: boolean;
  bookedCourseId?: string;
  bookedCourseName?: string;
  totalPrice?: number;
  paidAmount?: number;
  remainingAmount?: number;
  bookingDate?: number;
  isBookedOnCreation?: boolean;
  source?: ClientSource;
  profileLink?: string;
  transferHistory?: ClientTransfer[];
  isExternalTransfer?: boolean;
  originalCurrency?: string;
  originalTotalPrice?: number;
  originalPaidAmount?: number;
  exchangeRateUsed?: number;
  deductionAmount?: number;
  deductionReason?: string;
  aiRecommendation?: AiRecommendation;
  lastChatwootContactAt?: number;
  chatId?: string;
  distinctiveSearchPhrase?: string;
  automationSalesRepNameRaw?: string;
  createdVia?: 'ai_automation' | 'manual';
  reviewedBySales?: boolean;
  reviewedByName?: string;
  reviewedAt?: number;
  // Automatic personal follow-up every 2 weeks (booked clients). See utils/autoFollowUp.ts.
  autoFollowUp?: AutoFollowUpState;
  // Next personal check-in (اطمئنان) of a booked client, ms; 0/absent = none. Separate from nextFollowUpDate.
  nextCheckInDate?: number;
  // Written by the accounting sync (read-only in the CRM).
  accountingLatestBookingDate?: number;
  accounting?: ClientAccounting;
  // Written by the accounting sync / the client 360 pull (server only, see firestore.rules).
  activeBookingsCount?: number;
  multiCourse?: boolean;
  courseEndsAt?: string | null;
  alumniDue?: boolean;
  snapshot360?: ClientSnapshot360;
  // "عميل سابق": set by the owner agent one week after the course ended.
  isAlumni?: boolean;
  alumniSince?: number;
}

// client.accounting as written by functions/accountingIngest.js (money comes from accounting only).
export interface ClientAccountingBooking {
  id: string;
  status: string; // ACTIVE | DEACTIVATED | REFUNDED | DELETED
  courseName: string;
  total: number;
  paid: number;
  remaining: number;
  nextDueDate?: string | null;
}
export interface ClientAccounting {
  bookings?: Record<string, ClientAccountingBooking>;
  activeCount?: number;
}

// ---- client 360 (functions/clientSnapshot.js) -------------------------------------------
export interface SnapInstallment { dueDate: string; amount: number; paidAmount: number; status: 'pending' | 'paid' | 'delayed' | 'cancelled' | string; }
export interface SnapBooking {
  id: string; status: string; productName: string; productType?: string; bookingType?: string; bookingDate?: string;
  group?: { id?: string; name?: string; startDate?: string; status?: string; scheduleLabel?: string; trainer?: string } | null;
  pricing?: { listPrice?: number; finalPrice?: number; discount?: number; offer?: string; promoCode?: string; referralDiscount?: number; isScholarship?: boolean };
  paid: number; remaining: number; refundedTotal?: number;
  lastPayment?: { date: string; amount: number; method?: string } | null;
  nextDue?: { date: string; amount: number } | null;
  overdue?: { dueDate: string; amount: number }[];
  installments?: SnapInstallment[];
}
export interface SnapStudent {
  sourceBookingId: string; groupId?: string; groupName?: string; courseName?: string; startDate?: string; endDate?: string;
  totalSessions?: number; heldSessions?: number; attended?: number; attendancePct?: number;
  lastAttended?: { sessionNumber: number; date: string } | null;
  absenceStreak?: number;
  tasks?: { delivered: number; required: number };
  access?: { deactivated?: boolean; is50PercentPaid?: boolean; reasonCategory?: string };
  trainerName?: string; archived?: boolean;
  portal?: { hasLoggedIn?: boolean; lastLoginAt?: string | null; loginCount?: number };
  followUp?: { status?: string; lastContactAt?: string | null; lastChannel?: string };
  finalScore?: number | null;
}
export interface SnapCourse {
  bookingId: string; name: string; productType?: string; status: string; startDate: string; endDate: string; groupName: string;
  paid: number; remaining: number; finalPrice: number; nextDue: string; nextDueAmount: number; hasTraining: boolean;
}
export type LifecycleState = 'before_start' | 'running' | 'finished' | 'alumni_due' | 'unknown';
export interface ClientSnapshot360 {
  pulledAt: number; pulledBy: string; pulledByName: string;
  accounting: { found?: boolean; bookings?: SnapBooking[]; totals?: { bookings: number; active: number; paid: number; remaining: number } } | null;
  accountingError: string;
  training: { found?: boolean; students?: SnapStudent[] } | null;
  trainingError: string;
  followUps: { at: number; by: string; method: string; result: string; kind: string }[];
  courses: SnapCourse[];
  lifecycle: { courseEndsAt: string | null; alumniFrom: string | null; state: LifecycleState };
  briefing: string; model: string; usage: { inputTokens: number; outputTokens: number };
}

export interface FollowUp {
  id: string;
  clientId: string;
  clientName: string;
  agentId: string;
  agentName: string;
  note: string;
  result: string;
  salesBrief: string; // الحقل الجديد لموجز السيلز
  method: CommMethod;
  timestamp: number;
  startTime: number;
  endTime: number;
  duration: number; 
  scheduledTime: number;
  delayStatus: 'on_time' | 'acceptable' | 'large_delay';
  isEarly?: boolean;
  isAutomated?: boolean;
  chatwootConversationId?: string | null;
  reviewedBySales?: boolean;
  reviewedByName?: string;
  reviewedAt?: number;
  // 'auto_booked' = a done personal check-in (اطمئنان), logged with "تمت المتابعة".
  kind?: 'auto_booked';
}

export interface ClientTransfer {
  id: string;
  clientId: string;
  clientName: string;
  oldAgentId: string;
  oldAgentName: string;
  newAgentId: string;
  newAgentName: string;
  reason: string;
  timestamp: number;
  performedById: string;
  performedByName: string;
}

export interface DailyReport {
  id: string;
  userId: string;
  userName: string;
  date: string;
  submittedAt: number;
  
  // Auto-calculated stats
  newClients: number;
  interested: number;
  notInterested: number;
  potential: number;
  booked: number;
  scheduledToday: number;
  completedToday: number;
  overdueToday: number;
  largeDelays: number;
  punctualityRatio: number;
  
  // Financial stats
  totalPaidToday: number;
  totalRemainingToday: number;
  labelStats?: Record<string, number>;
  
  // Targets at submission
  targetNewClients: number;
  targetBookings: number;
  targetFollowUps: number;
  targetIncome: number;
  
  // Checklist
  checklist: {
    chatsCleared: boolean;
    clientLevelsChecked: boolean;
    laptopStatusChecked: boolean;
    clientStatusUpdated: boolean;
  };
  
  notes: string;
  isEdited?: boolean;
  editedBy?: string;
  editedAt?: number;
  aiAnalysis?: string;
  editHistory?: ReportEditLog[];

  // Shift metrics
  shiftId?: string;
  shiftStartedAt?: number;
  shiftEndedAt?: number;
  preShiftReviewDurationMs?: number;
  breaks?: ShiftBreakEntry[];
  totalWorkedMs?: number;

  // Supervisor reply
  supervisorReply?: string;
  supervisorReplyBy?: string;
  supervisorReplyAt?: number;
  acknowledgedBySales?: boolean;
  acknowledgedAt?: number;
}

export interface ShiftBreakEntry {
  startedAt: number;
  endedAt?: number;
  lateMinutes?: number;
}

export interface Shift {
  id: string;
  userId: string;
  userName: string;
  date: string; // YYYY-MM-DD local
  createdAt: number; // used to order same-day shifts
  status: 'reviewing' | 'active' | 'on_break' | 'ended';
  preShiftReviewStartedAt: number;
  startedAt?: number;
  preShiftReviewDurationMs?: number;
  breaks: ShiftBreakEntry[];
  endedAt?: number;
  reportId?: string;
  resetByAdmin?: boolean;
  resetByAdminName?: string;
}

export interface ReportEditLog {
  id: string;
  reportId: string;
  editorId: string;
  editorName: string;
  timestamp: number;
  previousNotes: string;
  newNotes: string;
  previousStats: Partial<DailyReport>;
  newStats: Partial<DailyReport>;
}

export interface Target {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  newClients: number;
  bookings: number;
  followUps: number;
  income: number;
}

export interface DefaultTarget {
  id: string;
  userId: string;
  newClients: number;
  bookings: number;
  followUps: number;
  income: number;
}

export interface BulkTransfer {
  id: string;
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string;
  toAgentName: string;
  clientCount: number;
  clientIds: string[];
  timestamp: number;
  performedById: string;
  performedByName: string;
  isUndone?: boolean;
}

export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  targetId: string;
  targetName: string;
  timestamp: number;
}
