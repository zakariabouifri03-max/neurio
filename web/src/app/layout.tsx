import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers, ThemeScript } from '@/components/providers';
import { getCurrentUser } from '@/lib/auth';
import type { Lang } from '@/i18n/dictionary';

/**
 * Webfonts are loaded by the browser (not at build time) so the app builds and
 * runs fully offline: the CSS variables fall back to system stacks, and the
 * editor loads only the families a document actually uses.
 */
const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Playfair+Display:wght@400;700&family=Cairo:wght@400;700;800&display=swap';

export const metadata: Metadata = {
  title: 'Prism Studio — professional visual design platform',
  description:
    'Design social posts, presentations, videos, documents, logos and print — with a real editor, AI assistant, brand kits and high-resolution export.',
  applicationName: 'Prism Studio',
  keywords: ['design', 'editor', 'templates', 'presentations', 'video editor', 'brand kit', 'AI design'],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0b0b10',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const sessionUser = user
    ? {
        id: user.id,
        name: user.name,
        email: user.guest ? '' : user.email,
        avatarUrl: user.avatarUrl,
        role: user.role,
        plan: user.plan,
        locale: (user.locale === 'ar' ? 'ar' : 'en') as Lang,
        aiCredits: user.aiCredits,
        storageUsed: user.storageUsed,
        storageQuota: user.storageQuota,
        onboarded: user.onboarded,
        guest: user.guest,
      }
    : null;

  return (
    <html lang={sessionUser?.locale ?? 'en'} dir={sessionUser?.locale === 'ar' ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <head>
        <ThemeScript />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONT_LINK} />
      </head>
      <body className="font-sans antialiased">
        <Providers user={sessionUser} lang={sessionUser?.locale ?? 'en'}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
