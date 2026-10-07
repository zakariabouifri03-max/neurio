#!/usr/bin/env node
/**
 * Seeds the catalogue (templates + elements) and optional demo content.
 *
 * The application also seeds lazily on first request; this script exists so a
 * deployment can warm the database during build/deploy instead of on first hit.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databasePath } from '../src/lib/data-path.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = databasePath();

if (!existsSync(dbPath)) {
  console.error(`[seed] ${dbPath} not found — run "npm run db:migrate" first.`);
  process.exit(1);
}

async function main() {

// Make sure the schema exists before seeding.
const schema = readFileSync(resolve(root, 'db/schema.sql'), 'utf8');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');
for (const statement of schema.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
  try {
    db.exec(`${statement};`);
  } catch (error) {
    if (!/already exists/i.test(String((error as Error)?.message))) throw error;
  }
}

// The catalogue itself is generated from code — build it through the same
// module the app uses so seeds and runtime can never drift.
  const { allTemplates } = await import('../src/data/templates');
  const { bundledElements } = await import('../src/data/elements');

const now = Date.now();
const templates = allTemplates();
const elements = bundledElements();

const insertTemplate = db.prepare(`
  INSERT OR IGNORE INTO templates (id, slug, name, description, category, subcategory, tags, data, preview,
    width, height, kind, author_name, license, status, featured, trending, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

const insertElement = db.prepare(`
  INSERT OR IGNORE INTO elements (id, slug, name, category, subcategory, tags, svg, width, height, colors,
    status, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
`);

let templateCount = 0;
let elementCount = 0;

db.exec('BEGIN');
try {
  for (const template of templates) {
    const slug = `${template.slug}-${template.id}`;
    const result = insertTemplate.run(
      template.id,
      slug,
      template.name,
      template.description,
      template.category,
      template.subcategory ?? null,
      JSON.stringify(template.tags),
      JSON.stringify({
        pages: template.pages,
        width: template.width,
        height: template.height,
        kind: template.kind,
        palette: template.palette,
      }),
      null,
      template.width,
      template.height,
      template.kind,
      'Prism Studio',
      'STANDARD',
      'PUBLISHED',
      template.featured ? 1 : 0,
      template.trending ? 1 : 0,
      now,
      now,
    );
    templateCount += Number(result.changes);
  }

  for (const element of elements.slice(0, 4000)) {
    const result = insertElement.run(
      element.id,
      `${element.category}-${element.id}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 90),
      element.name,
      element.category,
      element.subcategory ?? null,
      JSON.stringify(element.tags),
      element.svg,
      element.width,
      element.height,
      JSON.stringify(element.colors),
      'PUBLISHED',
      now,
    );
    elementCount += Number(result.changes);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

if (process.env.SEED_ADMIN_EMAIL) {
  const user = db.prepare('SELECT id, role FROM users WHERE email = ?').get(process.env.SEED_ADMIN_EMAIL);
  if (user && user.role !== 'ADMIN') {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run('ADMIN', user.id);
    console.log(`[seed] promoted ${process.env.SEED_ADMIN_EMAIL} to ADMIN`);
  } else if (!user) {
    console.log(`[seed] SEED_ADMIN_EMAIL set but no account exists yet — sign up with ${process.env.SEED_ADMIN_EMAIL} to become admin`);
  }
}

const count = (sql: string): number => Number(db.prepare(sql).get()?.c ?? 0);
const counts = {
  templates: count("SELECT COUNT(*) as c FROM templates WHERE status='PUBLISHED'"),
  elements: count("SELECT COUNT(*) as c FROM elements WHERE status='PUBLISHED'"),
  users: count('SELECT COUNT(*) as c FROM users'),
  projects: count('SELECT COUNT(*) as c FROM projects'),
};

console.log(`[seed] inserted ${templateCount} templates, ${elementCount} elements`);
console.log(`[seed] totals → templates: ${counts.templates}, elements: ${counts.elements}, users: ${counts.users}, projects: ${counts.projects}`);
db.close();

}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
