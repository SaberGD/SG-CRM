import type { Client } from '../types';

// Names of the client's ACTIVE accounting bookings (client.accounting.bookings, kept by the
// accounting sync). No read: it is already on the client document.
export function activeCourses(client: Pick<Client, 'accounting'>): string[] {
  return Object.values(client.accounting?.bookings || {})
    .filter((b) => b && b.status === 'ACTIVE')
    .map((b) => String(b.courseName || '').trim() || 'كورس');
}

const LEADER_ROLES = ['admin', 'administrator', 'manager', 'supervisor', 'team_leader', 'leader'];
// Who may pull the client file: the same rule the server enforces (owner agent, or a leader/admin).
export function canPullClientFile(user: { uid: string; role?: string } | null | undefined, client: Pick<Client, 'salesAgentId'>): boolean {
  if (!user) return false;
  return (!!client.salesAgentId && client.salesAgentId === user.uid) || LEADER_ROLES.includes(String(user.role || ''));
}
