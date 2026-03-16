
export enum UserRole {
  ADMIN = 'admin',
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
  FEMALE = 'female'
}

export enum LaptopStatus {
  WITH = 'with',
  WITHOUT = 'without'
}

export enum AttendanceMode {
  ONLINE = 'online',
  OFFLINE = 'offline'
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

export interface Client {
  id: string;
  name: string;
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

export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  targetId: string;
  targetName: string;
  timestamp: number;
}
