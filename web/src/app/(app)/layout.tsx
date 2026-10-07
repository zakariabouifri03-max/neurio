import { AppShell } from '@/components/app/AppShell';
import { getCurrentUser } from '@/lib/auth';

/**
 * Every visitor gets an identity (a real anonymous account), so the studio is
 * usable without signing up — there is no gate here on purpose.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await getCurrentUser();
  return <AppShell>{children}</AppShell>;
}
