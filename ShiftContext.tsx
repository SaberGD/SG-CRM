import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as firestore from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './App';
import { UserRole, Shift, ShiftBreakEntry } from './types';

const BREAK_DURATION_MS = 30 * 60 * 1000;
const BREAK_GRACE_MS = 5 * 60 * 1000;

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface ShiftContextType {
  shift: Shift | null;
  loading: boolean;
  isShiftApplicable: boolean;
  startShift: () => Promise<void>;
  startBreak: () => Promise<void>;
  endBreak: () => Promise<void>;
  endShift: () => Promise<Shift | null>;
  startNewShift: () => Promise<void>;
  isGateOpen: boolean;
  openGate: () => void;
  dismissGate: () => void;
  isEndModalOpen: boolean;
  openEndModal: () => void;
  closeEndModal: () => void;
}

const ShiftContext = createContext<ShiftContextType>({
  shift: null,
  loading: true,
  isShiftApplicable: false,
  startShift: async () => {},
  startBreak: async () => {},
  endBreak: async () => {},
  endShift: async () => null,
  startNewShift: async () => {},
  isGateOpen: false,
  openGate: () => {},
  dismissGate: () => {},
  isEndModalOpen: false,
  openEndModal: () => {},
  closeEndModal: () => {},
});

export const useShift = () => useContext(ShiftContext);

async function createFreshShift(userId: string, userName: string) {
  const now = Date.now();
  const newShift: Omit<Shift, 'id'> = {
    userId,
    userName,
    date: todayDateStr(),
    createdAt: now,
    status: 'reviewing',
    preShiftReviewStartedAt: now,
    breaks: [],
  };
  const ref = await firestore.addDoc(firestore.collection(db, 'shifts'), newShift);
  return ref.id;
}

export const ShiftProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, effectiveRole } = useAuth();
  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [gateDismissed, setGateDismissed] = useState(false);
  const [isEndModalOpen, setIsEndModalOpen] = useState(false);

  const isShiftApplicable = effectiveRole === UserRole.SALES_AGENT;
  const isGateOpen = !!shift && shift.status === 'reviewing' && !gateDismissed;

  useEffect(() => {
    if (!user || !isShiftApplicable) {
      setShift(null);
      setLoading(false);
      return;
    }

    let unsub: (() => void) | undefined;
    (async () => {
      const q = firestore.query(
        firestore.collection(db, 'shifts'),
        firestore.where('userId', '==', user.uid),
        firestore.where('date', '==', todayDateStr()),
        firestore.orderBy('createdAt', 'desc'),
        firestore.limit(1)
      );
      const snap = await firestore.getDocs(q);
      if (snap.empty) {
        await createFreshShift(user.uid, user.name);
      }
      unsub = firestore.onSnapshot(q, (s) => {
        if (!s.empty) {
          const d = s.docs[0];
          setShift({ id: d.id, ...d.data() } as Shift);
        } else {
          setShift(null);
        }
        setLoading(false);
      });
    })();

    return () => { if (unsub) unsub(); };
  }, [user, isShiftApplicable]);

  const startShift = useCallback(async () => {
    if (!shift) return;
    const now = Date.now();
    await firestore.updateDoc(firestore.doc(db, 'shifts', shift.id), {
      status: 'active',
      startedAt: now,
      preShiftReviewDurationMs: now - shift.preShiftReviewStartedAt,
    });
  }, [shift]);

  const startBreak = useCallback(async () => {
    if (!shift) return;
    const newBreak: ShiftBreakEntry = { startedAt: Date.now() };
    await firestore.updateDoc(firestore.doc(db, 'shifts', shift.id), {
      status: 'on_break',
      breaks: [...(shift.breaks || []), newBreak],
    });
  }, [shift]);

  const endBreak = useCallback(async () => {
    if (!shift || shift.breaks.length === 0) return;
    const breaks = [...shift.breaks];
    const last = breaks[breaks.length - 1];
    const now = Date.now();
    const elapsed = now - last.startedAt;
    const lateMs = elapsed - (BREAK_DURATION_MS + BREAK_GRACE_MS);
    breaks[breaks.length - 1] = {
      ...last,
      endedAt: now,
      lateMinutes: lateMs > 0 ? Math.round(lateMs / 60000) : 0,
    };
    await firestore.updateDoc(firestore.doc(db, 'shifts', shift.id), {
      status: 'active',
      breaks,
    });
  }, [shift]);

  const endShift = useCallback(async () => {
    if (!shift) return null;
    const now = Date.now();
    await firestore.updateDoc(firestore.doc(db, 'shifts', shift.id), {
      status: 'ended',
      endedAt: now,
    });
    return { ...shift, status: 'ended' as const, endedAt: now };
  }, [shift]);

  const startNewShift = useCallback(async () => {
    if (!user) return;
    setGateDismissed(false);
    await createFreshShift(user.uid, user.name);
  }, [user]);

  const openGate = useCallback(() => setGateDismissed(false), []);
  const dismissGate = useCallback(() => setGateDismissed(true), []);
  const openEndModal = useCallback(() => setIsEndModalOpen(true), []);
  const closeEndModal = useCallback(() => setIsEndModalOpen(false), []);

  return (
    <ShiftContext.Provider value={{
      shift, loading, isShiftApplicable, startShift, startBreak, endBreak, endShift, startNewShift,
      isGateOpen, openGate, dismissGate, isEndModalOpen, openEndModal, closeEndModal,
    }}>
      {children}
    </ShiftContext.Provider>
  );
};

export { BREAK_DURATION_MS, BREAK_GRACE_MS };
