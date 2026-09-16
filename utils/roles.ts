import { UserRole } from '../types';

export function isShiftTrackedRole(role?: UserRole | null): boolean {
  return role === UserRole.SALES_AGENT || role === UserRole.SUPERVISOR;
}

