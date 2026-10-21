import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => { tokenStore.clear(); setUser(null); }, []);

  // Restore the session on page load.
  useEffect(() => {
    if (!tokenStore.get()) return;
    api.get('/auth/me').then((r) => setUser(r.user)).catch(logout).finally(() => setLoading(false));
  }, [logout]);

  // Any 401 from the API (expired token) logs the user out.
  useEffect(() => {
    window.addEventListener('bookleaf:unauthorized', logout);
    return () => window.removeEventListener('bookleaf:unauthorized', logout);
  }, [logout]);

  const login = useCallback(async (email, password) => {
    const { token, user: u } = await api.post('/auth/login', { email, password });
    tokenStore.set(token);
    setUser(u);
    return u;
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
