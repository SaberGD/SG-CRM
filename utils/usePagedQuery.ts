import { useCallback, useEffect, useRef, useState } from 'react';
import * as firestore from 'firebase/firestore';
import { db } from '../firebase';

// Numbered pages over a Firestore query (same rules as the accounting system's hook):
// - each page reads only its own documents (no "load everything", no "load more");
// - pages already opened are kept in memory, so going back costs no reads;
// - the total uses Firestore's count aggregation (1 read per 1,000 matches);
// - leaving the page and coming back within a few minutes reuses the same pages (0 reads).
// Jumping ahead to a page not opened yet reads the pages in between once.

export interface PagedQueryOptions {
  collectionName: string;
  // null means "not ready yet" (e.g. waiting for the user profile).
  constraints: firestore.QueryConstraint[] | null;
  // Changes whenever the filters change; resets the pages.
  queryKey: string;
  // null keeps Firestore's default order (document id); needed for array-contains search
  // without an extra composite index.
  orderField: string | null;
  orderDirection?: 'asc' | 'desc';
  pageSize?: number;
  // Set false to skip the count read (e.g. lists that never get long).
  withTotal?: boolean;
}

export interface PagedQueryResult<T> {
  rows: T[];
  page: number;
  pageCount: number;
  total: number | null;
  reachablePage: number;
  pageSize: number;
  loading: boolean;
  error: unknown;
  goToPage: (page: number) => Promise<void>;
  reload: () => Promise<void>;
  // Update (or remove, with null) one row in place after a local write, without re-reading.
  patchRow: (id: string, patch: Partial<T> | null) => void;
}

interface CachedPage<T> { rows: T[]; lastDoc: any; }
interface SessionEntry { pages: Map<number, CachedPage<any>>; total: number | null; page: number; at: number; }

const SESSION_TTL = 3 * 60 * 1000;
const session = new Map<string, SessionEntry>();

export function usePagedQuery<T extends { id: string }>({
  collectionName, constraints, queryKey, orderField, orderDirection = 'desc', pageSize = 10, withTotal = true,
}: PagedQueryOptions): PagedQueryResult<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reachablePage, setReachablePage] = useState(1);
  const cache = useRef<Map<number, CachedPage<T>>>(new Map());
  const activeKey = useRef<string>('');
  const constraintsRef = useRef(constraints);
  constraintsRef.current = constraints;
  const sessionKey = `${collectionName}|${queryKey}|${orderField}|${orderDirection}|${pageSize}`;
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;

  const remember = (p: number, t: number | null) => {
    session.set(sessionKeyRef.current, { pages: cache.current, total: t, page: p, at: Date.now() });
  };

  const fetchOne = async (after: any): Promise<CachedPage<T>> => {
    const parts: firestore.QueryConstraint[] = [...(constraintsRef.current || [])];
    if (orderField) parts.push(firestore.orderBy(orderField, orderDirection));
    if (after) parts.push(firestore.startAfter(after));
    parts.push(firestore.limit(pageSize));
    const snap = await firestore.getDocs(firestore.query(firestore.collection(db, collectionName), ...parts));
    return {
      rows: snap.docs.map(d => ({ id: d.id, ...d.data() } as unknown as T)),
      lastDoc: snap.docs[snap.docs.length - 1] || null,
    };
  };

  const cachedPages = (): number[] => Array.from(cache.current.keys());

  const updateReachable = () => {
    const keys = cachedPages();
    const maxCached = keys.length ? Math.max(...keys) : 0;
    const last = cache.current.get(maxCached);
    setReachablePage(last && last.rows.length >= pageSize ? maxCached + 1 : Math.max(1, maxCached));
  };

  const totalRef = useRef<number | null>(null);
  totalRef.current = total;

  const goToPage = useCallback(async (target: number) => {
    if (!constraintsRef.current) return;
    const key = activeKey.current;
    const wanted = Math.max(1, target);
    const hit = cache.current.get(wanted);
    if (hit) {
      setRows(hit.rows);
      setPage(wanted);
      remember(wanted, totalRef.current);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let from = 0;
      cache.current.forEach((_, k) => { if (k < wanted && k > from) from = k; });
      let after = from ? cache.current.get(from)!.lastDoc : null;
      for (let p = from + 1; p <= wanted; p++) {
        const result = await fetchOne(after);
        if (activeKey.current !== key) return; // filters changed meanwhile
        cache.current.set(p, result);
        after = result.lastDoc;
        if (result.rows.length < pageSize && p < wanted) break; // end of results
      }
      const landed = Math.max(...cachedPages().filter(k => k <= wanted));
      setRows(cache.current.get(landed)?.rows || []);
      setPage(landed);
      updateReachable();
      remember(landed, totalRef.current);
    } catch (err) {
      console.error(`Paged query on ${collectionName} failed:`, err);
      if (activeKey.current === key) setError(err);
    } finally {
      if (activeKey.current === key) setLoading(false);
    }
  }, [collectionName, orderField, orderDirection, pageSize]);

  const start = useCallback(async (keepPage: number, useSession: boolean) => {
    if (!constraintsRef.current) return;
    const key = activeKey.current;
    const saved = useSession ? session.get(sessionKeyRef.current) : undefined;
    if (saved && Date.now() - saved.at < SESSION_TTL) {
      cache.current = saved.pages as Map<number, CachedPage<T>>;
      setTotal(saved.total);
      totalRef.current = saved.total;
      updateReachable();
      const p = cache.current.has(saved.page) ? saved.page : 1;
      setRows(cache.current.get(p)?.rows || []);
      setPage(p);
      return;
    }
    cache.current = new Map<number, CachedPage<T>>();
    setTotal(null);
    totalRef.current = null;
    if (withTotal) {
      firestore.getCountFromServer(firestore.query(firestore.collection(db, collectionName), ...constraintsRef.current))
        .then(snap => {
          if (activeKey.current !== key) return;
          setTotal(snap.data().count);
          totalRef.current = snap.data().count;
          remember(cache.current.size ? Math.max(...cachedPages()) : 1, snap.data().count);
        })
        .catch(err => console.error(`Count on ${collectionName} failed:`, err));
    }
    await goToPage(keepPage);
  }, [collectionName, goToPage, withTotal]);

  useEffect(() => {
    if (!constraints) return;
    activeKey.current = sessionKey;
    start(1, true);
  }, [sessionKey, constraints === null]);

  const reload = useCallback(() => start(page, false), [start, page]);

  const patchRow = useCallback((id: string, patch: Partial<T> | null) => {
    const apply = (list: T[]) => (patch === null ? list.filter(r => r.id !== id) : list.map(r => (r.id === id ? { ...r, ...patch } : r)));
    cache.current.forEach((p) => { p.rows = apply(p.rows); });
    setRows(prev => apply(prev));
    if (patch === null) setTotal(t => (t === null ? t : Math.max(0, t - 1)));
  }, []);

  const pageCount = total === null ? reachablePage : Math.max(1, Math.ceil(total / pageSize));
  return { rows, page, pageCount, total, reachablePage, pageSize, loading, error, goToPage, reload, patchRow };
}

// Same pager contract over a list that is already in memory (small collections).
export function usePagedList<T>(items: T[], pageSize = 10, resetKey = '') {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey]);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const rows = items.slice((safePage - 1) * pageSize, safePage * pageSize);
  return {
    rows, page: safePage, pageCount, total: items.length, reachablePage: pageCount, pageSize, loading: false,
    goToPage: async (p: number) => setPage(Math.max(1, Math.min(p, pageCount))),
  };
}
