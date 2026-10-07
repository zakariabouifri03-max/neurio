'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nProvider, useI18n } from '@/i18n/provider';
import { ToastProvider } from '@/components/ui/toast';
import type { Lang } from '@/i18n/dictionary';

export type SessionUserLite = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  plan: string;
  locale: Lang;
  aiCredits: number;
  storageUsed: number;
  storageQuota: number;
  onboarded: boolean;
  /** Anonymous visitor account — the studio is fully usable without signing up. */
  guest?: boolean;
};

type SessionValue = { user: SessionUserLite | null; refresh: () => Promise<void>; setUser: (u: SessionUserLite | null) => void };

const SessionContext = createContext<SessionValue>({ user: null, refresh: async () => {}, setUser: () => {} });

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

export function Providers({
  children,
  user,
  lang = 'en',
}: {
  children: ReactNode;
  user?: SessionUserLite | null;
  lang?: Lang;
}) {
  return (
    <I18nProvider initialLang={lang}>
      <SessionBridge initialUser={user ?? null}>{children}</SessionBridge>
    </I18nProvider>
  );
}

function SessionBridge({ children, initialUser }: { children: ReactNode; initialUser: SessionUserLite | null }) {
  const [current, setCurrent] = useState<SessionUserLite | null>(initialUser);
  const { setLang } = useI18n();

  useEffect(() => {
    if (current?.locale) setLang(current.locale);
  }, [current?.locale, setLang]);

  const refresh = useMemo(
    () => async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const json = await res.json();
        setCurrent(json.ok ? json.data : null);
      } catch {
        /* offline — keep the current value */
      }
    },
    [],
  );

  const value = useMemo<SessionValue>(() => ({ user: current, refresh, setUser: setCurrent }), [current, refresh]);

  return (
    <SessionContext.Provider value={value}>
      <ToastProvider>{children}</ToastProvider>
    </SessionContext.Provider>
  );
}

/** Theme (dark/light) persisted per device. */
export function ThemeScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){try{var t=localStorage.getItem('prism.theme');if(t==='light'){document.documentElement.setAttribute('data-theme','light');}}catch(e){}})();`,
      }}
    />
  );
}

export function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const stored = (localStorage.getItem('prism.theme') as 'dark' | 'light' | null) ?? 'dark';
    setTheme(stored);
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('prism.theme', next);
    document.documentElement.setAttribute('data-theme', next === 'light' ? 'light' : 'dark');
  };
  return { theme, toggle };
}
