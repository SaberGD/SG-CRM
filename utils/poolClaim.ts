import * as firestore from 'firebase/firestore';
import { db, logActivity } from '../firebase';
import { Client, ClientTransfer } from '../types';

// "Assign to me" for a client sitting on the shared pool account. One batch: the owner fields
// (the only fields the rules let a sales agent change here) + the agent's own transfer record.
export async function claimPoolClient(client: Pick<Client, 'id' | 'name' | 'salesAgentId' | 'salesAgentName'>, user: { uid: string; name: string }) {
  const now = Date.now();
  const record: ClientTransfer = {
    id: crypto.randomUUID(),
    clientId: client.id, clientName: client.name || '',
    oldAgentId: client.salesAgentId, oldAgentName: client.salesAgentName || '',
    newAgentId: user.uid, newAgentName: user.name,
    reason: 'Assign to me من الحساب المشترك', timestamp: now,
    performedById: user.uid, performedByName: user.name,
  };
  const batch = firestore.writeBatch(db);
  batch.update(firestore.doc(db, 'clients', client.id), { salesAgentId: user.uid, salesAgentName: user.name, claimedFromPoolAt: now });
  batch.set(firestore.doc(firestore.collection(db, 'transfers')), record);
  await batch.commit();
  await logActivity(user.uid, user.name, 'تعيين عميل لنفسه من حساب Saber Group المشترك', client.id, client.name);
}
