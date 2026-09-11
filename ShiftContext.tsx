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
}

const ShiftContext = createContext<ShiftContextType>({
  shift: null,
  loading: true,
  isShiftApplicable: false,
  startShift: async () => {},
  startBreak: async () => {},
  endBreak: async () => {},
  endShift: async () => null,
});

export const useShift = () => useContext(ShiftContext);

export const ShiftProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, effectiveRole } = useAuth();
  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);

  const isShiftApplicable = effectiveRole === UserRole.SALES_AGENT;

  useEffect(() => {
    if (!user || !isShiftApplicable) {
      setShift(null);
      setLoading(false);
      return;
    }
    const shiftId = `${user.uid}_${todayDateStr()}`;
    const ref = firestore.doc(db, 'shifts', shiftId);

    let unsub: (() => void) | undefined;
    (async () => {
      const snap = await firestore.getDoc(ref);
      if (!snap.exists()) {
        const newShift: Omit<Shift, 'id'> = {
          userId: user.uid,
          userName: user.name,
          date: todayDateStr(),
          status: 'reviewing',
          preShiftReviewStartedAt: Date.now(),
          breaks: [],
        };
        await firestore.setDoc(ref, newShift);
      }
      unsub = firestore.onSnapshot(ref, (s) => {
        if (s.exists()) {
          setShift({ id: s.id, ...s.data() } as Shift);
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

  return (
    <ShiftContext.Provider value={{ shift, loading, isShiftApplicable, startShift, startBreak, endBreak, endShift }}>
      {children}
    </ShiftContext.Provider>
  );
};

export { BREAK_DURATION_MS, BREAK_GRACE_MS };
