-- ===========================================================================
--  Prism Studio — portable SQL schema (SQLite syntax, ANSI-clean)
--
--  Runs on the built-in `node:sqlite` engine with zero external services.
--  Every statement is plain SQL and every table uses portable column types, so
--  the same schema loads on PostgreSQL with only these substitutions:
--     INTEGER PRIMARY KEY ................. keep (or BIGSERIAL)
--     TEXT ................................ keep
--     REAL ................................ keep
--     BIGINT epoch-ms ..................... keep
--  Application code never writes raw SQL outside of src/lib/repo/*, so moving
--  to Postgres means swapping the driver in src/lib/db.ts — nothing else.
--
--  Conventions
--   * ids are cuid-style TEXT strings (sortable, URL safe, client generatable)
--   * JSON payloads are TEXT columns (→ jsonb on Postgres)
--   * enums are TEXT + CHECK constraints (→ native enums on Postgres)
--   * timestamps are ISO-8601 UTC strings
-- ===========================================================================

PRAGMA foreign_keys = ON;

/* ------------------------------------------------------------ identity ---- */

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  name           TEXT NOT NULL,
  password_hash  TEXT,
  avatar_url     TEXT,
  locale         TEXT NOT NULL DEFAULT 'en',
  role           TEXT NOT NULL DEFAULT 'USER'      CHECK (role IN ('USER','ADMIN')),
  plan           TEXT NOT NULL DEFAULT 'FREE'      CHECK (plan IN ('FREE','PRO','TEAM','ENTERPRISE')),
  storage_used   INTEGER NOT NULL DEFAULT 0,
  storage_quota  INTEGER NOT NULL DEFAULT 1073741824,
  ai_credits     INTEGER NOT NULL DEFAULT 200,
  onboarded      INTEGER NOT NULL DEFAULT 0,
  disabled       INTEGER NOT NULL DEFAULT 0,
  -- 1 for anonymous guest accounts auto-created so the studio works without sign-up
  is_guest       INTEGER NOT NULL DEFAULT 0,
  oauth_provider TEXT,
  oauth_subject  TEXT,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,          -- sha256 of the cookie value
  user_agent TEXT,
  ip         TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS verification_tokens (
  id         TEXT PRIMARY KEY,
  token      TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  email      TEXT,
  meta       TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);

CREATE TABLE IF NOT EXISTS teams (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  slug      TEXT NOT NULL UNIQUE,
  owner_id  TEXT NOT NULL,
  plan      TEXT NOT NULL DEFAULT 'TEAM',
  seats     INTEGER NOT NULL DEFAULT 5,
  logo_url  TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);

CREATE TABLE IF NOT EXISTS team_members (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'EDITOR' CHECK (role IN ('OWNER','ADMIN','EDITOR','VIEWER')),
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  UNIQUE (team_id, user_id)
);

/* ------------------------------------------------------------ projects ---- */

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT,
  trashed    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_folders_owner ON folders(owner_id, parent_id);

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id     TEXT REFERENCES folders(id) ON DELETE SET NULL,
  title         TEXT NOT NULL DEFAULT 'Untitled design',
  kind          TEXT NOT NULL DEFAULT 'design' CHECK (kind IN ('design','presentation','document','video','whiteboard')),
  category      TEXT,
  width         INTEGER NOT NULL DEFAULT 1080,
  height        INTEGER NOT NULL DEFAULT 1080,
  data          TEXT NOT NULL DEFAULT '{}',   -- DocSettings JSON
  thumbnail     TEXT,
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','link','public')),
  share_slug    TEXT UNIQUE,
  favorite      INTEGER NOT NULL DEFAULT 0,
  trashed       INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1,
  last_opened_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_trashed ON projects(owner_id, trashed);
CREATE INDEX IF NOT EXISTS idx_projects_folder ON projects(folder_id);

CREATE TABLE IF NOT EXISTS pages (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  name       TEXT NOT NULL DEFAULT 'Page 1',
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  background TEXT NOT NULL DEFAULT '{"color":"#ffffff"}',
  nodes      TEXT NOT NULL DEFAULT '[]',      -- node tree JSON
  meta       TEXT NOT NULL DEFAULT '{}',      -- notes, page settings
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_pages_project ON pages(project_id, idx);

CREATE TABLE IF NOT EXISTS versions (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  number     INTEGER NOT NULL,
  label      TEXT,
  snapshot   TEXT NOT NULL,                   -- full document JSON
  auto       INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collab_ops (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  seq        INTEGER NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  UNIQUE (project_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_ops_project ON collab_ops(project_id, seq);

/* ------------------------------------------------------- collaboration ---- */

CREATE TABLE IF NOT EXISTS shares (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT,
  role         TEXT NOT NULL DEFAULT 'VIEWER' CHECK (role IN ('OWNER','ADMIN','EDITOR','VIEWER')),
  granted_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_shares_project ON shares(project_id);
CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
CREATE INDEX IF NOT EXISTS idx_shares_email ON shares(email);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_id    TEXT,
  node_id    TEXT,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES comments(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  mentions   TEXT NOT NULL DEFAULT '[]',
  resolved   INTEGER NOT NULL DEFAULT 0,
  x          REAL,
  y          REAL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id, created_at);

CREATE TABLE IF NOT EXISTS activity (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  meta       TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, created_at DESC);

/* -------------------------------------------------------------- assets ---- */

CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  storage_key TEXT,
  provider    TEXT NOT NULL DEFAULT 'local',
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  width       INTEGER,
  height      INTEGER,
  duration    REAL,
  folder_id   TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  favorite    INTEGER NOT NULL DEFAULT 0,
  meta        TEXT NOT NULL DEFAULT '{}',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_assets_owner_kind ON assets(owner_id, kind);
CREATE INDEX IF NOT EXISTS idx_assets_owner_date ON assets(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS brand_kits (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'My brand',
  logo_url   TEXT,
  colors     TEXT NOT NULL DEFAULT '[]',
  fonts      TEXT NOT NULL DEFAULT '{}',
  templates  TEXT NOT NULL DEFAULT '[]',
  images     TEXT NOT NULL DEFAULT '[]',
  guidelines TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_brand_owner ON brand_kits(owner_id);

CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL,
  subcategory TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  data        TEXT NOT NULL,
  preview     TEXT,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'design',
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT,
  license     TEXT NOT NULL DEFAULT 'STANDARD',
  status      TEXT NOT NULL DEFAULT 'PUBLISHED',
  featured    INTEGER NOT NULL DEFAULT 0,
  trending    INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  rating      REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_featured ON templates(featured, usage_count DESC);

CREATE TABLE IF NOT EXISTS elements (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  subcategory TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  svg         TEXT NOT NULL,
  colors      TEXT NOT NULL DEFAULT '[]',
  width       INTEGER NOT NULL DEFAULT 100,
  height      INTEGER NOT NULL DEFAULT 100,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  license     TEXT NOT NULL DEFAULT 'STANDARD',
  status      TEXT NOT NULL DEFAULT 'PUBLISHED',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_elements_category ON elements(category, status);

/* ------------------------------------------------------ billing / admin --- */

CREATE TABLE IF NOT EXISTS subscriptions (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan                 TEXT NOT NULL DEFAULT 'FREE',
  status               TEXT NOT NULL DEFAULT 'ACTIVE',
  provider             TEXT,
  provider_customer_id TEXT,
  provider_sub_id      TEXT,
  seats                INTEGER NOT NULL DEFAULT 1,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);

CREATE TABLE IF NOT EXISTS usage (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  amount     INTEGER NOT NULL DEFAULT 1,
  meta       TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_kind ON usage(kind, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  reason       TEXT NOT NULL,
  details      TEXT,
  status       TEXT NOT NULL DEFAULT 'OPEN',
  author_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  moderator_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

/* ------------------------------------------------------------ favorites --- */

CREATE TABLE IF NOT EXISTS favorites (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,     -- TEMPLATE | ELEMENT
  ref_id     TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  UNIQUE (user_id, kind, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, kind);

CREATE TABLE IF NOT EXISTS media_folders (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES media_folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
);
CREATE INDEX IF NOT EXISTS idx_media_folders_owner ON media_folders(owner_id);

/* Full-text search over user content (designs + assets + templates). */
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  ref_id UNINDEXED,
  kind UNINDEXED,
  owner_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61'
);
