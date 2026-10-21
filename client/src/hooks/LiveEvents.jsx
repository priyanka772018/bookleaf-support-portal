import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { connectLiveEvents } from '../api/liveEvents';
import { useAuth } from '../auth/AuthContext';

const LiveContext = createContext({ status: 'offline', subscribe: () => () => {} });

/** One SSE connection per logged-in session, shared by every page. */
export function LiveEventsProvider({ children }) {
  const { user } = useAuth();
  const [status, setStatus] = useState('offline');
  const listeners = useRef(new Set());

  useEffect(() => {
    if (!user) return undefined;
    setStatus('connecting');
    return connectLiveEvents({
      onStatus: setStatus,
      onEvent: (type, data) => listeners.current.forEach((fn) => fn(type, data)),
    });
  }, [user]);

  const subscribe = useCallback((fn) => { listeners.current.add(fn); return () => listeners.current.delete(fn); }, []);
  return <LiveContext.Provider value={{ status, subscribe }}>{children}</LiveContext.Provider>;
}

export const useLiveStatus = () => useContext(LiveContext).status;

/**
 * Calls `handler(type, data)` for every live event. Also fires a synthetic
 * 'refocus' event when the tab regains focus, as a safety net for missed events.
 */
export function useLiveEvents(handler) {
  const { subscribe } = useContext(LiveContext);
  const ref = useRef(handler);
  useLayoutEffect(() => { ref.current = handler; });
  useEffect(() => {
    const unsub = subscribe((t, d) => ref.current(t, d));
    const onFocus = () => ref.current('refocus', {});
    window.addEventListener('focus', onFocus);
    return () => { unsub(); window.removeEventListener('focus', onFocus); };
  }, [subscribe]);
}
