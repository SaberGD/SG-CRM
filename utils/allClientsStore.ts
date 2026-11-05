import { useEffect, useState } from 'react';
import * as firestore from 'firebase/firestore';
import { db } from '../firebase';
import { Client } from '../types';

// One live listener on every client, shared by the admin-only Maro analysis page.
// Opening that page used to start a new listener each visit (≈3,400 reads every time).
// The listener now stays alive for 10 minutes after the page is left, so coming back
// costs nothing; after that it stops so it doesn't keep paying for every change.
const IDLE_MS = 10 * 60 * 1000;
let data: Client[] = [];
let ready = false;
let unsub: (() => void) | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<(d: Client[], ready: boolean) => void>();

const ensure = () => {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  if (unsub) return;
  unsub = firestore.onSnapshot(firestore.collection(db, 'clients'), (snap) => {
    data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Client));
    ready = true;
    subs.forEach((fn) => fn(data, true));
  }, (err) => {
    console.error('All-clients listener failed:', err);
    unsub = null;
    ready = true;
    subs.forEach((fn) => fn(data, true));
  });
};

export const useAllClientsLive = (enabled: boolean): { clients: Client[]; loading: boolean } => {
  const [state, setState] = useState<{ clients: Client[]; loading: boolean }>({ clients: data, loading: !ready });
  useEffect(() => {
    if (!enabled) return;
    const fn = (d: Client[], r: boolean) => setState({ clients: d, loading: !r });
    subs.add(fn);
    ensure();
    if (ready) fn(data, true);
    return () => {
      subs.delete(fn);
      if (subs.size === 0) stopTimer = setTimeout(() => { unsub?.(); unsub = null; ready = false; }, IDLE_MS);
    };
  }, [enabled]);
  return state;
};
