import { useEffect, useState } from 'react';
import * as firestore from 'firebase/firestore';
import { db } from '../firebase';
import { Label, Service, User, UserRole } from '../types';

// Small reference collections (services, labels, staff) are read ONCE per session through a
// single shared live listener, instead of every page opening its own listener and re-reading
// the whole collection on each visit. Later changes cost only the changed documents.

type Store<T> = { data: T[]; ready: boolean; subs: Set<(d: T[]) => void>; started: boolean };
const makeStore = <T,>(): Store<T> => ({ data: [], ready: false, subs: new Set(), started: false });

const stores = {
  services: makeStore<Service>(),
  labels: makeStore<Label>(),
  users: makeStore<User>(),
};

const start = <T,>(store: Store<T>, col: string, map: (d: firestore.QueryDocumentSnapshot) => T) => {
  if (store.started) return;
  store.started = true;
  firestore.onSnapshot(firestore.collection(db, col), (snap) => {
    store.data = snap.docs.map(map);
    store.ready = true;
    store.subs.forEach((fn) => fn(store.data));
  }, (err) => {
    console.error(`${col} listener failed:`, err);
    store.started = false; // allow a retry on the next subscriber (e.g. after sign-in)
  });
};

const useStore = <T,>(store: Store<T>, col: string, map: (d: firestore.QueryDocumentSnapshot) => T): T[] => {
  const [data, setData] = useState<T[]>(store.data);
  useEffect(() => {
    start(store, col, map);
    store.subs.add(setData);
    if (store.ready) setData(store.data);
    return () => { store.subs.delete(setData); };
  }, []);
  return data;
};

const asService = (d: firestore.QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Service);
const asLabel = (d: firestore.QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Label);
const asUser = (d: firestore.QueryDocumentSnapshot) => ({ ...d.data(), uid: d.id } as User);

/** All services; pass activeOnly to hide disabled ones. */
export const useServices = (activeOnly = false): Service[] => {
  const all = useStore(stores.services, 'services', asService);
  return activeOnly ? all.filter((s) => s.isActive) : all;
};

export const useLabels = (): Label[] => useStore(stores.labels, 'labels', asLabel);

/** Every staff profile (users collection is small: one doc per employee). */
export const useStaff = (): User[] => useStore(stores.users, 'users', asUser);

export const SALES_ROLES = [UserRole.SALES_AGENT, UserRole.TEAM_LEADER, UserRole.MANAGER, UserRole.SUPERVISOR];

/** Active staff in the given roles, as { id, name } sorted by name. */
export const useAgentOptions = (roles: UserRole[] = SALES_ROLES) => {
  const staff = useStaff();
  return staff
    .filter((u) => !u.isDeactivated && roles.includes(u.role))
    .map((u) => ({ id: u.uid, name: u.name || u.email || 'بدون اسم', role: u.role }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
};
