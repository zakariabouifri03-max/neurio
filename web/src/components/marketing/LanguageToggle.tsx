'use client';

import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { useSession } from '@/components/providers';

export function LanguageToggle() {
  const { lang, setLang } = useI18n();
  const { user } = useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const next = lang === 'en' ? 'ar' : 'en';

  const apply = () => {
    setLang(next);
    if (user) {
      fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: next }),
      }).catch(() => undefined);
    }
    // Direction/RTL is applied by the i18n provider; force a re-render of text.
    document.documentElement.lang = next;
  };

  return (
    <button
      type="button"
      onClick={apply}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px]"
      style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
      aria-label="Switch language"
    >
      <Languages size={14} />
      {mounted ? (lang === 'en' ? 'العربية' : 'English') : 'Language'}
    </button>
  );
}
