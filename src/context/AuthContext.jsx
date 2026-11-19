import { createContext, useContext, useState, useEffect } from 'react';
import { can } from '../../shared/permissions';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let active = true;
    const sync = () => Promise.resolve(window.api.checkAuth?.()).then(current => {
      if (active) { setUser(current || null); if (!current) localStorage.removeItem('pos_session'); }
    }).catch(() => { if (active) { setUser(null); localStorage.removeItem('pos_session'); } })
      .finally(() => { if (active) setChecking(false); });
    sync();
    window.addEventListener('focus', sync);
    return () => { active = false; window.removeEventListener('focus', sync); };
  }, []);

  const login = (userData) => {
    localStorage.setItem('pos_session', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = async () => {
    await window.api.logout?.();
    localStorage.removeItem('pos_session');
    setUser(null);
  };
  const refresh = async () => {
    const current = await window.api.checkAuth();
    setUser(current);
    if (current) localStorage.setItem('pos_session', JSON.stringify(current));
    else localStorage.removeItem('pos_session');
    return current;
  };

  return (
    <AuthContext.Provider value={{ user, checking, login, logout, refresh, can: permission => can(user, permission) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam <AuthProvider>');
  return ctx;
}
