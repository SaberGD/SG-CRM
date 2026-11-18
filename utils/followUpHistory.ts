import * as firestore from 'firebase/firestore';
import { db } from '../firebase';
import { FollowUp } from '../types';

// Live follow-up history of one client (newest 100).
// Leaders, and everyone while the old rules are live, read the whole history with one query.
// Under the scoped rules a sales agent may only read follow-ups they wrote or whose
// clientAgentId is theirs / the pool's: when the whole-history query is denied we switch to
// those two queries and merge them. Indexes: (clientId, agentId, timestamp desc) and
// (clientId, clientAgentId, timestamp desc).
export function subscribeClientFollowUps(clientId: string, uid: string, onRows: (rows: FollowUp[]) => void): () => void {
  const ref = firestore.collection(db, 'followups');
  const unsubs: Array<() => void> = [];
  let stopped = false;
  const toRows = (snap: firestore.QuerySnapshot) => snap.docs.map(d => ({ id: d.id, ...d.data() } as FollowUp));

  const scoped = () => {
    if (stopped || !uid) return;
    const parts: Record<string, FollowUp[]> = { mine: [], owner: [] };
    const emit = () => {
      const byId = new Map<string, FollowUp>();
      [...parts.mine, ...parts.owner].forEach(f => byId.set(f.id, f));
      onRows([...byId.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 100));
    };
    const listen = (key: 'mine' | 'owner', field: string, value: string) => unsubs.push(firestore.onSnapshot(
      firestore.query(ref, firestore.where('clientId', '==', clientId), firestore.where(field, '==', value), firestore.orderBy('timestamp', 'desc'), firestore.limit(100)),
      (snap) => { parts[key] = toRows(snap); emit(); },
      (err) => console.error(`Follow-up history (${key}) failed:`, err),
    ));
    listen('mine', 'agentId', uid);
    // The client is readable, so its owner is the agent or the pool; follow-ups stamped with
    // that owner are readable too. We don't know the pool uid here, so ask the client doc.
    firestore.getDoc(firestore.doc(db, 'clients', clientId)).then((c) => {
      const owner = c.exists() ? String(c.get('salesAgentId') || '') : '';
      if (owner && !stopped) listen('owner', 'clientAgentId', owner);
    }).catch((err) => console.error('Follow-up history owner lookup failed:', err));
  };

  unsubs.push(firestore.onSnapshot(
    firestore.query(ref, firestore.where('clientId', '==', clientId), firestore.orderBy('timestamp', 'desc'), firestore.limit(100)),
    (snap) => onRows(toRows(snap)),
    (err) => {
      if ((err as any)?.code === 'permission-denied') scoped();
      else console.error('ClientDetails Followups Snapshot Error:', err);
    },
  ));

  return () => { stopped = true; unsubs.forEach(u => u()); };
}
