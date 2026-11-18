import { where, QueryConstraint } from 'firebase/firestore';

// One definition of "overdue" for every page (Today's work, Dashboard, Notifications, the alarm):
// an OPEN lead (interested / potential) whose next follow-up time has passed. Booked and
// not-interested clients are never overdue. Firestore indexes used:
// (status, nextFollowUpDate) and (salesAgentId, status, nextFollowUpDate).
export const OPEN_STATUSES = ['interested', 'potential'];

export const overdueConstraints = (now = Date.now()): QueryConstraint[] => [
  where('status', 'in', OPEN_STATUSES),
  where('nextFollowUpDate', '>', 0),
  where('nextFollowUpDate', '<', now),
];

export const isOverdue = (c: { status?: string; nextFollowUpDate?: number }, now = Date.now()) =>
  OPEN_STATUSES.includes(String(c.status || '')) && !!c.nextFollowUpDate && c.nextFollowUpDate > 0 && c.nextFollowUpDate < now;
