import 'server-only';
import { templates, users, brandKits } from './repo';
import { allTemplates } from '@/data/templates';

/**
 * Lazy, idempotent seeding.
 *
 * Running a separate migration step is easy to forget, so the first request
 * that needs catalogue data seeds it. Guarded by an in-process flag plus a row
 * count, which makes it safe under concurrent requests and hot reloads.
 */
let seeded = false;

export function ensureSeeded(): void {
  if (seeded) return;
  if (templates.count() > 0) {
    seeded = true;
    return;
  }
  const all = allTemplates();
  for (const template of all) {
    templates.upsert({
      slug: template.slug,
      name: template.name,
      description: template.description,
      category: template.category,
      subcategory: template.subcategory ?? null,
      tags: template.tags,
      data: { pages: template.pages, width: template.width, height: template.height, kind: template.kind, palette: template.palette },
      preview: null,
      width: template.width,
      height: template.height,
      kind: template.kind,
      authorName: 'Prism Studio',
      featured: template.featured,
      trending: template.trending,
    });
  }
  seeded = true;
  if (process.env.SEED_ADMIN_EMAIL) {
    const existing = users.byEmail(process.env.SEED_ADMIN_EMAIL);
    if (existing && existing.role !== 'ADMIN') users.update(existing.id, { role: 'ADMIN' });
  }
  console.log(`[seed] template catalogue ready — ${all.length} templates`);
}

/** Creates the starter assets every new account gets. */
export function seedUserDefaults(userId: string): void {
  const existing = brandKits.list(userId);
  if (existing.length) return;
  brandKits.create(userId, {
    name: 'My brand',
    colors: [
      { name: 'Primary', value: '#6C5CE7' },
      { name: 'Accent', value: '#00B894' },
      { name: 'Ink', value: '#12121A' },
      { name: 'Paper', value: '#FFFFFF' },
    ],
    fonts: { heading: 'Playfair Display', body: 'Inter' },
    isDefault: true,
  });
}

/** Promotes the first account (or SEED_ADMIN_EMAIL) to admin. */
export function ensureAdmin(email?: string): void {
  if (!email) return;
  const user = users.byEmail(email);
  if (user && user.role !== 'ADMIN') users.update(user.id, { role: 'ADMIN' });
}
