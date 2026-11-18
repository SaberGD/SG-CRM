import * as firestore from 'firebase/firestore';
import { db } from '../firebase';
import { ClientTransfer } from '../types';

// One way to move clients to another agent, used by the single transfer, the bulk transfer,
// its undo and the admin "deactivate and redistribute" flow:
// - every client gets a transferHistory entry and a `transfers` record (the Dashboard counts them);
// - writes go in batches of at most 400 (a Firestore batch holds 500), so an agent with
//   thousands of clients can be moved;
// - the caller writes its own summary (e.g. bulk_transfers) only AFTER this returns, so a
//   failure never leaves a phantom undo record;
// - follow-ups of the moved clients are re-stamped with the new owner (clientAgentId), so the new
//   agent can read their history under the scoped rules. That step is best effort: it never fails
//   the transfer (older rules only let managers touch follow-ups).

export interface TransferTarget { id: string; name: string }
export interface TransferClient { id: string; name: string; salesAgentId?: string; salesAgentName?: string }
export interface TransferOptions {
  to: TransferTarget;
  reason: string;
  performedBy: { uid: string; name: string };
  /** Overrides the "from" agent shown in the records (default: each client's current agent). */
  from?: TransferTarget;
}

const BATCH_WRITES = 400;
const WRITES_PER_CLIENT = 2; // client update + transfers record

export async function transferClients(clients: TransferClient[], opts: TransferOptions): Promise<{ moved: string[]; followUpsRestamped: number; followUpError?: unknown }> {
  const timestamp = Date.now();
  const moved: string[] = [];
  const perBatch = Math.floor(BATCH_WRITES / WRITES_PER_CLIENT);
  for (let i = 0; i < clients.length; i += perBatch) {
    const batch = firestore.writeBatch(db);
    const chunk = clients.slice(i, i + perBatch);
    for (const c of chunk) {
      const record: ClientTransfer = {
        id: crypto.randomUUID(),
        clientId: c.id, clientName: c.name || '',
        oldAgentId: opts.from?.id ?? c.salesAgentId ?? '', oldAgentName: opts.from?.name ?? c.salesAgentName ?? '',
        newAgentId: opts.to.id, newAgentName: opts.to.name,
        reason: opts.reason, timestamp,
        performedById: opts.performedBy.uid, performedByName: opts.performedBy.name,
      };
      batch.update(firestore.doc(db, 'clients', c.id), {
        salesAgentId: opts.to.id,
        salesAgentName: opts.to.name,
        transferHistory: firestore.arrayUnion(record),
      });
      batch.set(firestore.doc(firestore.collection(db, 'transfers')), record);
    }
    await batch.commit();
    moved.push(...chunk.map(c => c.id));
  }

  let followUpsRestamped = 0;
  let followUpError: unknown;
  try {
    followUpsRestamped = await restampFollowUps(moved, opts.to.id);
  } catch (err) {
    followUpError = err;
    console.warn('Follow-up owner re-stamp skipped:', err);
  }
  return { moved, followUpsRestamped, followUpError };
}

/** Sets clientAgentId on every follow-up of these clients (30 ids per query, 400 writes per batch). */
export async function restampFollowUps(clientIds: string[], agentId: string): Promise<number> {
  let n = 0;
  let batch = firestore.writeBatch(db);
  let pending = 0;
  for (let i = 0; i < clientIds.length; i += 30) {
    const snap = await firestore.getDocs(firestore.query(
      firestore.collection(db, 'followups'), firestore.where('clientId', 'in', clientIds.slice(i, i + 30)),
    ));
    for (const d of snap.docs) {
      if (d.get('clientAgentId') === agentId) continue;
      batch.update(d.ref, { clientAgentId: agentId });
      pending++; n++;
      if (pending >= BATCH_WRITES) { await batch.commit(); batch = firestore.writeBatch(db); pending = 0; }
    }
  }
  if (pending) await batch.commit();
  return n;
}
