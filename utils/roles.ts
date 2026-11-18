import { UserRole } from '../types';

// One place for role tiers, matching firestore.rules (isAdmin / isManager / isTeamLeader).
// Supervisor is manager-tier everywhere (it used to count as sales on some pages only).
type R = UserRole | string | null | undefined;

export const isAdminRole = (role: R): boolean => role === UserRole.ADMIN || role === 'administrator';

export const isManagerRole = (role: R): boolean =>
  isAdminRole(role) || role === UserRole.MANAGER || role === UserRole.SUPERVISOR;

/** Leaders: full read of clients/follow-ups, transfers, invitations (sales only unless admin). */
export const isLeaderRole = (role: R): boolean =>
  isManagerRole(role) || role === UserRole.TEAM_LEADER || role === 'leader';

export function isShiftTrackedRole(role?: UserRole | null): boolean {
  return role === UserRole.SALES_AGENT || role === UserRole.SUPERVISOR;
}
