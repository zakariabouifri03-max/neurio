import 'server-only';
import { all, bool, db, get, int, now, parseJson, placeholders, run, stringifyJson, tx } from './db';
import { newId, slugify } from './ids';

/**
 * Repository layer — the only place that writes SQL.
 *
 * Every function takes/returns domain objects (camelCase, JSON parsed), so the
 * API routes and server components never touch column names. Swapping the
 * database engine means reimplementing this file only.
 */

export type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

/* ========================================================================== */
/* Users                                                                       */
/* ========================================================================== */

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  plan: string;
  locale: string;
  emailVerified: boolean;
  passwordHash: string | null;
  aiCredits: number;
  storageUsed: number;
  storageQuota: number;
  onboarded: boolean;
  disabled: boolean;
  isGuest: boolean;
  oauthProvider: string | null;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapUser(r: any): UserRecord {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    avatarUrl: r.avatar_url,
    role: r.role,
    plan: r.plan,
    locale: r.locale,
    emailVerified: bool(r.email_verified),
    passwordHash: r.password_hash,
    aiCredits: int(r.ai_credits),
    storageUsed: int(r.storage_used),
    storageQuota: int(r.storage_quota),
    onboarded: bool(r.onboarded),
    disabled: bool(r.disabled),
    isGuest: bool(r.is_guest),
    oauthProvider: r.oauth_provider,
    createdAt: int(r.created_at),
    updatedAt: int(r.updated_at),
    lastSeenAt: r.last_seen_at == null ? null : int(r.last_seen_at),
  };
}

export const users = {
  byEmail(email: string): UserRecord | null {
    const row = get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    return row ? mapUser(row) : null;
  },
  byId(id: string): UserRecord | null {
    const row = get('SELECT * FROM users WHERE id = ?', [id]);
    return row ? mapUser(row) : null;
  },
  byOAuth(provider: string, subject: string): UserRecord | null {
    const row = get('SELECT * FROM users WHERE oauth_provider = ? AND oauth_subject = ?', [provider, subject]);
    return row ? mapUser(row) : null;
  },
  create(input: {
    email: string;
    name: string;
    passwordHash?: string | null;
    avatarUrl?: string | null;
    locale?: string;
    role?: string;
    oauth?: { provider: string; subject: string } | null;
    /** Anonymous visitor account — never shown a password prompt. */
    guest?: boolean;
  }): UserRecord {
    const id = newId('usr');
    run(
      `INSERT INTO users (id, email, name, password_hash, avatar_url, locale, role,
         oauth_provider, oauth_subject, email_verified, is_guest, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.email.trim().toLowerCase(),
        input.name,
        input.passwordHash ?? null,
        input.avatarUrl ?? null,
        input.locale ?? 'en',
        input.role ?? 'USER',
        input.oauth?.provider ?? null,
        input.oauth?.subject ?? null,
        input.oauth ? 1 : 0,
        input.guest ? 1 : 0,
        now(),
        now(),
      ],
    );
    return users.byId(id)!;
  },
  update(id: string, patch: Partial<Record<string, unknown>>): void {
    const columns: Record<string, string> = {
      name: 'name',
      email: 'email',
      avatarUrl: 'avatar_url',
      locale: 'locale',
      role: 'role',
      plan: 'plan',
      aiCredits: 'ai_credits',
      storageUsed: 'storage_used',
      storageQuota: 'storage_quota',
      onboarded: 'onboarded',
      disabled: 'disabled',
      isGuest: 'is_guest',
      passwordHash: 'password_hash',
      emailVerified: 'email_verified',
    };
    const sets: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = columns[key];
      if (!column) continue;
      sets.push(`${column} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    values.push(now(), id);
    run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
  },
  setPassword(id: string, passwordHash: string): void {
    run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, now(), id]);
  },
  list(opts: { search?: string; limit?: number; offset?: number; role?: string } = {}) {
    const where: string[] = [];
    const values: any[] = [];
    if (opts.search) {
      where.push('(email LIKE ? OR name LIKE ?)');
      values.push(`%${opts.search}%`, `%${opts.search}%`);
    }
    if (opts.role) {
      where.push('role = ?');
      values.push(opts.role);
    }
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const rows = all(
      `SELECT * FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset],
    );
    const total = get<{ c: number }>(
      `SELECT COUNT(*) as c FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
      values,
    );
    return { items: rows.map(mapUser), total: int(total?.c) };
  },
  count(): number {
    return int(get<{ c: number }>('SELECT COUNT(*) as c FROM users')?.c);
  },
};

/* ========================================================================== */
/* Projects & pages                                                            */
/* ========================================================================== */

export type ProjectRecord = {
  id: string;
  ownerId: string;
  folderId: string | null;
  title: string;
  kind: string;
  category: string | null;
  width: number;
  height: number;
  data: any;
  thumbnail: string | null;
  visibility: string;
  shareSlug: string | null;
  favorite: boolean;
  trashed: boolean;
  version: number;
  lastOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
  ownerName?: string;
  ownerAvatar?: string | null;
  role?: Role;
  pageCount?: number;
};

function mapProject(r: any): ProjectRecord {
  return {
    id: r.id,
    ownerId: r.owner_id,
    folderId: r.folder_id,
    title: r.title,
    kind: r.kind,
    category: r.category,
    width: int(r.width, 1080),
    height: int(r.height, 1080),
    data: parseJson(r.data, {}),
    thumbnail: r.thumbnail,
    visibility: r.visibility,
    shareSlug: r.share_slug,
    favorite: bool(r.favorite),
    trashed: bool(r.trashed),
    version: int(r.version, 1),
    lastOpenedAt: r.last_opened_at == null ? null : int(r.last_opened_at),
    createdAt: int(r.created_at),
    updatedAt: int(r.updated_at),
    ownerName: r.owner_name,
    ownerAvatar: r.owner_avatar,
    role: r.role as Role | undefined,
    pageCount: r.page_count != null ? int(r.page_count) : undefined,
  };
}

export type PageRecord = {
  id: string;
  projectId: string;
  index: number;
  name: string;
  width: number;
  height: number;
  background: any;
  nodes: any;
  meta: any;
  createdAt: number;
  updatedAt: number;
};

function mapPage(r: any): PageRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    index: int(r.idx),
    name: r.name,
    width: int(r.width),
    height: int(r.height),
    background: parseJson(r.background, { color: '#ffffff' }),
    nodes: parseJson(r.nodes, []),
    meta: parseJson(r.meta, {}),
    createdAt: int(r.created_at),
    updatedAt: int(r.updated_at),
  };
}

export type ProjectFilter = {
  folderId?: string | null;
  trashed?: boolean;
  favorite?: boolean;
  kind?: string;
  search?: string;
  sort?: 'updated' | 'created' | 'title';
  limit?: number;
  offset?: number;
  sharedWith?: string;
};

export const projects = {
  list(ownerId: string, filter: ProjectFilter = {}): ProjectRecord[] {
    const where: string[] = [];
    const values: any[] = [];

    if (filter.sharedWith) {
      where.push('(p.owner_id = ? OR p.id IN (SELECT project_id FROM shares WHERE user_id = ?))');
      values.push(ownerId, ownerId);
    } else {
      where.push('p.owner_id = ?');
      values.push(ownerId);
    }
    where.push('p.trashed = ?');
    values.push(filter.trashed ? 1 : 0);
    if (filter.folderId !== undefined) {
      where.push(filter.folderId === null ? 'p.folder_id IS NULL' : 'p.folder_id = ?');
      if (filter.folderId !== null) values.push(filter.folderId);
    }
    if (filter.favorite) {
      where.push('p.favorite = 1');
    }
    if (filter.kind) {
      where.push('p.kind = ?');
      values.push(filter.kind);
    }
    if (filter.search) {
      where.push('(p.title LIKE ? OR p.category LIKE ?)');
      const term = `%${filter.search}%`;
      values.push(term, term);
    }
    const order =
      filter.sort === 'created' ? 'p.created_at DESC' : filter.sort === 'title' ? 'p.title ASC' : 'p.updated_at DESC';
    const limit = Math.min(filter.limit ?? 60, 200);
    const offset = filter.offset ?? 0;

    return all<any>(
      `SELECT p.*, u.name as owner_name, u.avatar_url as owner_avatar,
              (SELECT COUNT(*) FROM pages g WHERE g.project_id = p.id) as page_count
       FROM projects p JOIN users u ON u.id = p.owner_id
       WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...values, limit, offset],
    ).map(mapProject);
  },

  get(id: string): ProjectRecord | null {
    const row = get<any>(
      `SELECT p.*, u.name as owner_name, u.avatar_url as owner_avatar FROM projects p
       JOIN users u ON u.id = p.owner_id WHERE p.id = ?`,
      [id],
    );
    return row ? mapProject(row) : null;
  },

  byShareSlug(slug: string): ProjectRecord | null {
    const row = get<any>('SELECT * FROM projects WHERE share_slug = ?', [slug]);
    return row ? mapProject(row) : null;
  },

  create(input: {
    ownerId: string;
    title: string;
    kind?: string;
    width?: number;
    height?: number;
    data?: unknown;
    folderId?: string | null;
    category?: string | null;
    thumbnail?: string | null;
  }): ProjectRecord {
    const id = newId('prj');
    const t = now();
    run(
      `INSERT INTO projects (id, owner_id, folder_id, title, kind, category, width, height, data,
        thumbnail, created_at, updated_at, last_opened_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.ownerId,
        input.folderId ?? null,
        input.title,
        input.kind ?? 'design',
        input.category ?? null,
        input.width ?? 1080,
        input.height ?? 1080,
        stringifyJson(input.data ?? {}),
        input.thumbnail ?? null,
        t,
        t,
        t,
      ],
    );
    return projects.get(id)!;
  },

  update(id: string, patch: Partial<Record<string, unknown>>): void {
    const columns: Record<string, string> = {
      title: 'title',
      folderId: 'folder_id',
      kind: 'kind',
      category: 'category',
      width: 'width',
      height: 'height',
      data: 'data',
      thumbnail: 'thumbnail',
      visibility: 'visibility',
      shareSlug: 'share_slug',
      favorite: 'favorite',
      trashed: 'trashed',
      version: 'version',
      lastOpenedAt: 'last_opened_at',
    };
    const sets: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = columns[key];
      if (!column) continue;
      sets.push(`${column} = ?`);
      values.push(
        typeof value === 'boolean'
          ? value
            ? 1
            : 0
          : key === 'data'
            ? stringifyJson(value)
            : value === undefined
              ? null
              : value,
      );
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    values.push(now(), id);
    run(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, values);
  },

  touch(id: string): void {
    run('UPDATE projects SET updated_at = ?, last_opened_at = ? WHERE id = ?', [now(), now(), id]);
  },

  incrementVersion(id: string): number {
    const project = projects.get(id);
    const next = (project?.version ?? 1) + 1;
    run('UPDATE projects SET version = ?, updated_at = ? WHERE id = ?', [next, now(), id]);
    return next;
  },

  hardDelete(id: string): void {
    tx(() => {
      run('DELETE FROM pages WHERE project_id = ?', [id]);
      run('DELETE FROM versions WHERE project_id = ?', [id]);
      run('DELETE FROM comments WHERE project_id = ?', [id]);
      run('DELETE FROM shares WHERE project_id = ?', [id]);
      run('DELETE FROM activity WHERE project_id = ?', [id]);
      run('DELETE FROM collab_ops WHERE project_id = ?', [id]);
      run('DELETE FROM projects WHERE id = ?', [id]);
    });
  },

  /** Copies a project (and its pages) — used by duplicate and "use template". */
  duplicate(id: string, ownerId: string, title?: string): ProjectRecord {
    const source = projects.get(id);
    if (!source) throw new Error('Project not found');
    const pages = projects.pages(id);
    const copy = projects.create({
      ownerId,
      title: title ?? `${source.title} copy`,
      kind: source.kind,
      width: source.width,
      height: source.height,
      data: source.data,
      folderId: source.folderId,
      category: source.category,
      thumbnail: source.thumbnail,
    });
    projects.savePages(
      copy.id,
      pages.map((p) => ({
        name: p.name,
        width: p.width,
        height: p.height,
        background: p.background,
        nodes: p.nodes,
        meta: p.meta,
      })),
    );
    return copy;
  },

  /* ---------------------------------------------------------------- pages */
  pages(projectId: string): PageRecord[] {
    return all<any>('SELECT * FROM pages WHERE project_id = ? ORDER BY idx ASC', [projectId]).map(mapPage);
  },

  page(projectId: string, index: number): PageRecord | null {
    const row = get('SELECT * FROM pages WHERE project_id = ? AND idx = ?', [projectId, index]);
    return row ? mapPage(row) : null;
  },

  /** Replaces the page set atomically (autosave writes the whole page list). */
  savePages(
    projectId: string,
    pages: { id?: string; name?: string; width: number; height: number; background?: unknown; nodes: unknown; meta?: unknown }[],
  ): PageRecord[] {
    return tx(() => {
      const existing = new Map(projects.pages(projectId).map((p) => [p.id, p]));
      const keep = new Set<string>();
      pages.forEach((page, index) => {
        const id = page.id && existing.has(page.id) ? page.id! : newId('pag');
        keep.add(id);
        const background = stringifyJson(page.background ?? { color: '#ffffff' });
        const meta = stringifyJson(page.meta ?? {});
        const nodes = stringifyJson(page.nodes);
        if (existing.has(id)) {
          run('UPDATE pages SET idx = ?, name = ?, width = ?, height = ?, background = ?, nodes = ?, meta = ?, updated_at = ? WHERE id = ?', [
            index,
            page.name ?? `Page ${index + 1}`,
            page.width,
            page.height,
            background,
            nodes,
            meta,
            now(),
            id,
          ]);
        } else {
          run(
            `INSERT INTO pages (id, project_id, idx, name, width, height, background, nodes, meta, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [id, projectId, index, page.name ?? `Page ${index + 1}`, page.width, page.height, background, nodes, meta, now(), now()],
          );
        }
      });
      for (const old of existing.keys()) {
        if (!keep.has(old)) run('DELETE FROM pages WHERE id = ?', [old]);
      }
      run('UPDATE projects SET updated_at = ? WHERE id = ?', [now(), projectId]);
      return projects.pages(projectId);
    });
  },
};

/* ========================================================================== */
/* Access control                                                              */
/* ========================================================================== */

export const access = {
  /** Effective role for a user on a project, or null when they cannot see it. */
  roleFor(projectId: string, userId: string | null): Role | null {
    const project = get<any>('SELECT owner_id, visibility FROM projects WHERE id = ?', [projectId]);
    if (!project) return null;
    if (userId && project.owner_id === userId) return 'OWNER';
    if (userId) {
      const share = get<any>('SELECT role FROM shares WHERE project_id = ? AND user_id = ?', [projectId, userId]);
      if (share) return share.role as Role;
    }
    if (project.visibility === 'link' || project.visibility === 'public') return 'VIEWER';
    return null;
  },

  canEdit(projectId: string, userId: string | null): boolean {
    const role = access.roleFor(projectId, userId);
    return role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR';
  },

  canView(projectId: string, userId: string | null): boolean {
    return access.roleFor(projectId, userId) !== null;
  },
};

/* ========================================================================== */
/* Folders                                                                     */
/* ========================================================================== */

export type FolderRecord = {
  id: string;
  ownerId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  trashed: boolean;
  createdAt: number;
  projectCount?: number;
};

export const folders = {
  list(ownerId: string): FolderRecord[] {
    return all<any>(
      `SELECT f.*, (SELECT COUNT(*) FROM projects p WHERE p.folder_id = f.id AND p.trashed = 0) as project_count
       FROM folders f WHERE f.owner_id = ? AND f.trashed = 0 ORDER BY f.name`,
      [ownerId],
    ).map((r) => ({
      id: r.id,
      ownerId: r.owner_id,
      parentId: r.parent_id,
      name: r.name,
      color: r.color,
      trashed: bool(r.trashed),
      createdAt: int(r.created_at),
      projectCount: int(r.project_count),
    }));
  },
  create(ownerId: string, name: string, parentId?: string | null, color?: string | null): FolderRecord {
    const id = newId('fld');
    run('INSERT INTO folders (id, owner_id, parent_id, name, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', [
      id,
      ownerId,
      parentId ?? null,
      name,
      color ?? null,
      now(),
      now(),
    ]);
    return { id, ownerId, parentId: parentId ?? null, name, color: color ?? null, trashed: false, createdAt: now() };
  },
  rename(id: string, ownerId: string, name: string): void {
    run('UPDATE folders SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?', [name, now(), id, ownerId]);
  },
  trash(id: string, ownerId: string): void {
    run('UPDATE folders SET trashed = 1, updated_at = ? WHERE id = ? AND owner_id = ?', [now(), id, ownerId]);
  },
  remove(id: string, ownerId: string): void {
    tx(() => {
      run('UPDATE projects SET folder_id = NULL WHERE folder_id = ? AND owner_id = ?', [id, ownerId]);
      run('DELETE FROM folders WHERE id = ? AND owner_id = ?', [id, ownerId]);
    });
  },
};

/* ========================================================================== */
/* Versions                                                                    */
/* ========================================================================== */

export type VersionRecord = {
  id: string;
  projectId: string;
  creatorId: string | null;
  creatorName?: string | null;
  label: string | null;
  number: number;
  snapshot: any;
  auto: boolean;
  createdAt: number;
};

export const versions = {
  list(projectId: string, limit = 60): VersionRecord[] {
    return all<any>(
      `SELECT v.*, u.name as creator_name FROM versions v
       LEFT JOIN users u ON u.id = v.creator_id
       WHERE v.project_id = ? ORDER BY v.created_at DESC LIMIT ?`,
      [projectId, limit],
    ).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      creatorId: r.creator_id,
      creatorName: r.creator_name,
      label: r.label,
      number: int(r.number),
      snapshot: parseJson(r.snapshot, null),
      auto: bool(r.auto),
      createdAt: int(r.created_at),
    }));
  },
  create(projectId: string, snapshot: unknown, opts: { creatorId?: string | null; label?: string; auto?: boolean; number?: number } = {}): VersionRecord {
    const id = newId('ver');
    const number = opts.number ?? int(get<{ c: number }>('SELECT COUNT(*) as c FROM versions WHERE project_id = ?', [projectId])?.c) + 1;
    run(
      `INSERT INTO versions (id, project_id, creator_id, number, label, snapshot, auto, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, projectId, opts.creatorId ?? null, number, opts.label ?? null, stringifyJson(snapshot), opts.auto ? 1 : 0, now()],
    );
    // Keep the last 100 versions per project — older ones are pruned.
    run(
      `DELETE FROM versions WHERE project_id = ? AND id NOT IN (
         SELECT id FROM versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 100)`,
      [projectId, projectId],
    );
    return versions.get(id)!;
  },
  get(id: string): VersionRecord | null {
    const row = get<any>(
      `SELECT v.*, u.name as creator_name FROM versions v LEFT JOIN users u ON u.id = v.creator_id WHERE v.id = ?`,
      [id],
    );
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      creatorId: row.creator_id,
      creatorName: row.creator_name,
      label: row.label,
      number: int(row.number),
      snapshot: parseJson(row.snapshot, null),
      auto: bool(row.auto),
      createdAt: int(row.created_at),
    };
  },
  remove(id: string): void {
    run('DELETE FROM versions WHERE id = ?', [id]);
  },
};

/* ========================================================================== */
/* Assets (media library)                                                      */
/* ========================================================================== */

export type AssetRecord = {
  id: string;
  ownerId: string;
  kind: string;
  name: string;
  url: string;
  storageKey: string | null;
  provider: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  folderId: string | null;
  tags: string[];
  favorite: boolean;
  meta: any;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
};

function mapAsset(r: any): AssetRecord {
  return {
    id: r.id,
    ownerId: r.owner_id,
    kind: r.kind,
    name: r.name,
    url: r.url,
    storageKey: r.storage_key,
    provider: r.provider,
    mime: r.mime,
    size: int(r.size),
    width: r.width == null ? null : int(r.width),
    height: r.height == null ? null : int(r.height),
    duration: r.duration == null ? null : Number(r.duration),
    folderId: r.folder_id,
    tags: parseJson<string[]>(r.tags, []),
    favorite: bool(r.favorite),
    meta: parseJson(r.meta, {}),
    usageCount: int(r.usage_count),
    createdAt: int(r.created_at),
    updatedAt: int(r.updated_at),
  };
}

export const assets = {
  list(
    ownerId: string,
    opts: { kind?: string; search?: string; favorite?: boolean; folderId?: string | null; limit?: number; offset?: number; sort?: string } = {},
  ): AssetRecord[] {
    const where = ['owner_id = ?'];
    const values: any[] = [ownerId];
    if (opts.kind && opts.kind !== 'ALL') {
      where.push('kind = ?');
      values.push(opts.kind);
    }
    if (opts.search) {
      where.push('(name LIKE ? OR tags LIKE ?)');
      values.push(`%${opts.search}%`, `%${opts.search}%`);
    }
    if (opts.favorite) where.push('favorite = 1');
    if (opts.folderId !== undefined && opts.folderId !== null) {
      where.push('folder_id = ?');
      values.push(opts.folderId);
    }
    const order =
      opts.sort === 'name' ? 'name ASC' : opts.sort === 'used' ? 'usage_count DESC' : 'created_at DESC';
    return all<any>(
      `SELECT * FROM assets WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...values, Math.min(opts.limit ?? 100, 300), opts.offset ?? 0],
    ).map(mapAsset);
  },
  get(id: string): AssetRecord | null {
    const row = get('SELECT * FROM assets WHERE id = ?', [id]);
    return row ? mapAsset(row) : null;
  },
  create(input: {
    ownerId: string;
    kind: string;
    name: string;
    url: string;
    storageKey?: string | null;
    provider?: string;
    mime: string;
    size: number;
    width?: number | null;
    height?: number | null;
    duration?: number | null;
    folderId?: string | null;
    tags?: string[];
    meta?: unknown;
  }): AssetRecord {
    const id = newId('ast');
    run(
      `INSERT INTO assets (id, owner_id, kind, name, url, storage_key, provider, mime, size, width, height,
        duration, folder_id, tags, meta, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.ownerId,
        input.kind,
        input.name,
        input.url,
        input.storageKey ?? null,
        input.provider ?? 'local',
        input.mime,
        input.size,
        input.width ?? null,
        input.height ?? null,
        input.duration ?? null,
        input.folderId ?? null,
        stringifyJson(input.tags ?? []),
        stringifyJson(input.meta ?? {}),
        now(),
        now(),
      ],
    );
    return assets.get(id)!;
  },
  update(id: string, ownerId: string, patch: Partial<Record<string, unknown>>): void {
    const columns: Record<string, string> = {
      name: 'name',
      favorite: 'favorite',
      tags: 'tags',
      folderId: 'folder_id',
      meta: 'meta',
    };
    const sets: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = columns[key];
      if (!column) continue;
      sets.push(`${column} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : key === 'tags' || key === 'meta' ? stringifyJson(value) : value);
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    values.push(now(), id, ownerId);
    run(`UPDATE assets SET ${sets.join(', ')} WHERE id = ? AND owner_id = ?`, values);
  },
  touchUsage(id: string): void {
    run('UPDATE assets SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?', [now(), id]);
  },
  remove(id: string, ownerId: string): AssetRecord | null {
    const asset = assets.get(id);
    if (!asset || asset.ownerId !== ownerId) return null;
    run('DELETE FROM assets WHERE id = ?', [id]);
    return asset;
  },
  storageUsed(ownerId: string): number {
    return int(get<{ s: number }>('SELECT COALESCE(SUM(size),0) as s FROM assets WHERE owner_id = ?', [ownerId])?.s);
  },
};

/* ========================================================================== */
/* Brand kits                                                                  */
/* ========================================================================== */

export type BrandKitRecord = {
  id: string;
  ownerId: string;
  name: string;
  logoUrl: string | null;
  colors: { name?: string; value: string }[];
  fonts: { heading: string; body: string; accent?: string };
  templates: string[];
  images: string[];
  guidelines: string | null;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
};

export const brandKits = {
  list(ownerId: string): BrandKitRecord[] {
    return all<any>('SELECT * FROM brand_kits WHERE owner_id = ? ORDER BY is_default DESC, name', [ownerId]).map((r) => ({
      id: r.id,
      ownerId: r.owner_id,
      name: r.name,
      logoUrl: r.logo_url,
      colors: parseJson(r.colors, []),
      fonts: parseJson(r.fonts, { heading: 'Playfair Display', body: 'Inter' }),
      templates: parseJson(r.templates, []),
      images: parseJson(r.images, []),
      guidelines: r.guidelines,
      isDefault: bool(r.is_default),
      createdAt: int(r.created_at),
      updatedAt: int(r.updated_at),
    }));
  },
  byId(id: string): BrandKitRecord | null {
    const r = get<any>('SELECT * FROM brand_kits WHERE id = ?', [id]);
    if (!r) return null;
    return {
      id: r.id,
      ownerId: r.owner_id,
      name: r.name,
      logoUrl: r.logo_url,
      colors: parseJson(r.colors, []),
      fonts: parseJson(r.fonts, { heading: 'Playfair Display', body: 'Inter' }),
      templates: parseJson(r.templates, []),
      images: parseJson(r.images, []),
      guidelines: r.guidelines,
      isDefault: bool(r.is_default),
      createdAt: int(r.created_at),
      updatedAt: int(r.updated_at),
    };
  },
  create(ownerId: string, input: Partial<BrandKitRecord> = {}): BrandKitRecord {
    const id = newId('brk');
    const isDefault = input.isDefault ?? false;
    if (isDefault) run('UPDATE brand_kits SET is_default = 0 WHERE owner_id = ?', [ownerId]);
    run(
      `INSERT INTO brand_kits (id, owner_id, name, logo_url, colors, fonts, templates, images, guidelines, is_default, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        ownerId,
        input.name ?? 'My brand',
        input.logoUrl ?? null,
        stringifyJson(input.colors ?? []),
        stringifyJson(input.fonts ?? { heading: 'Playfair Display', body: 'Inter' }),
        stringifyJson(input.templates ?? []),
        stringifyJson(input.images ?? []),
        input.guidelines ?? null,
        isDefault ? 1 : 0,
        now(),
        now(),
      ],
    );
    return brandKits.byId(id)!;
  },
  update(id: string, ownerId: string, patch: Partial<Record<string, unknown>>): void {
    const columns: Record<string, string> = {
      name: 'name',
      logoUrl: 'logo_url',
      colors: 'colors',
      fonts: 'fonts',
      templates: 'templates',
      images: 'images',
      guidelines: 'guidelines',
      isDefault: 'is_default',
    };
    if (patch.isDefault) run('UPDATE brand_kits SET is_default = 0 WHERE owner_id = ?', [ownerId]);
    const sets: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = columns[key];
      if (!column) continue;
      sets.push(`${column} = ?`);
      const json = key === 'colors' || key === 'fonts' || key === 'templates' || key === 'images';
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : json ? stringifyJson(value) : value);
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    values.push(now(), id, ownerId);
    run(`UPDATE brand_kits SET ${sets.join(', ')} WHERE id = ? AND owner_id = ?`, values);
  },
  remove(id: string, ownerId: string): void {
    run('DELETE FROM brand_kits WHERE id = ? AND owner_id = ?', [id, ownerId]);
  },
};

/* ========================================================================== */
/* Templates                                                                   */
/* ========================================================================== */

export type TemplateRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  subcategory: string | null;
  tags: string[];
  data: any;
  preview: string | null;
  width: number;
  height: number;
  kind: string;
  authorId: string | null;
  authorName: string | null;
  license: string;
  status: string;
  featured: boolean;
  trending: boolean;
  usageCount: number;
  rating: number;
  createdAt: number;
  updatedAt: number;
};

function mapTemplate(r: any): TemplateRecord {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    category: r.category,
    subcategory: r.subcategory,
    tags: parseJson<string[]>(r.tags, []),
    data: parseJson(r.data, null),
    preview: r.preview,
    width: int(r.width),
    height: int(r.height),
    kind: r.kind,
    authorId: r.author_id,
    authorName: r.author_name,
    license: r.license,
    status: r.status,
    featured: bool(r.featured),
    trending: bool(r.trending),
    usageCount: int(r.usage_count),
    rating: Number(r.rating ?? 0),
    createdAt: int(r.created_at),
    updatedAt: int(r.updated_at),
  };
}

export const templates = {
  list(opts: { category?: string; search?: string; featured?: boolean; trending?: boolean; limit?: number; offset?: number; sort?: string } = {}) {
    const where = ["status = 'PUBLISHED'"];
    const values: any[] = [];
    if (opts.category && opts.category !== 'ALL') {
      where.push('category = ?');
      values.push(opts.category);
    }
    if (opts.search) {
      where.push('(name LIKE ? OR tags LIKE ? OR category LIKE ?)');
      const t = `%${opts.search}%`;
      values.push(t, t, t);
    }
    if (opts.featured) where.push('featured = 1');
    if (opts.trending) where.push('trending = 1');
    const order =
      opts.sort === 'popular' ? 'usage_count DESC' : opts.sort === 'new' ? 'created_at DESC' : opts.sort === 'name' ? 'name ASC' : 'featured DESC, usage_count DESC, created_at DESC';
    const rows = all<any>(
      `SELECT * FROM templates WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...values, Math.min(opts.limit ?? 60, 240), opts.offset ?? 0],
    );
    const total = int(
      get<{ c: number }>(`SELECT COUNT(*) as c FROM templates WHERE ${where.join(' AND ')}`, values)?.c,
    );
    return { items: rows.map(mapTemplate), total };
  },
  byId(id: string): TemplateRecord | null {
    const row = get('SELECT * FROM templates WHERE id = ?', [id]);
    return row ? mapTemplate(row) : null;
  },
  bySlug(slug: string): TemplateRecord | null {
    const row = get('SELECT * FROM templates WHERE slug = ?', [slug]);
    return row ? mapTemplate(row) : null;
  },
  categories(): { category: string; count: number }[] {
    return all<{ category: string; count: number }>(
      `SELECT category, COUNT(*) as count FROM templates WHERE status = 'PUBLISHED' GROUP BY category ORDER BY count DESC`,
    );
  },
  upsert(input: {
    slug: string;
    name: string;
    description?: string | null;
    category: string;
    subcategory?: string | null;
    tags?: string[];
    data: unknown;
    preview?: string | null;
    width: number;
    height: number;
    kind?: string;
    authorId?: string | null;
    authorName?: string | null;
    featured?: boolean;
    trending?: boolean;
    license?: string;
    status?: string;
  }): TemplateRecord {
    const existing = templates.bySlug(input.slug);
    if (existing) {
      run(
        `UPDATE templates SET name = ?, description = ?, category = ?, subcategory = ?, tags = ?, data = ?,
          preview = ?, width = ?, height = ?, kind = ?, featured = ?, trending = ?, updated_at = ?
         WHERE slug = ?`,
        [
          input.name,
          input.description ?? null,
          input.category,
          input.subcategory ?? null,
          stringifyJson(input.tags ?? []),
          stringifyJson(input.data),
          input.preview ?? null,
          input.width,
          input.height,
          input.kind ?? 'design',
          input.featured ? 1 : 0,
          input.trending ? 1 : 0,
          now(),
          input.slug,
        ],
      );
      return templates.bySlug(input.slug)!;
    }
    const id = newId('tpl');
    run(
      `INSERT INTO templates (id, slug, name, description, category, subcategory, tags, data, preview, width, height,
        kind, author_id, author_name, license, status, featured, trending, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.slug,
        input.name,
        input.description ?? null,
        input.category,
        input.subcategory ?? null,
        stringifyJson(input.tags ?? []),
        stringifyJson(input.data),
        input.preview ?? null,
        input.width,
        input.height,
        input.kind ?? 'design',
        input.authorId ?? null,
        input.authorName ?? null,
        input.license ?? 'STANDARD',
        input.status ?? 'PUBLISHED',
        input.featured ? 1 : 0,
        input.trending ? 1 : 0,
        now(),
        now(),
      ],
    );
    return templates.byId(id)!;
  },
  use(id: string): void {
    run('UPDATE templates SET usage_count = usage_count + 1 WHERE id = ?', [id]);
  },
  count(): number {
    return int(get<{ c: number }>("SELECT COUNT(*) as c FROM templates WHERE status = 'PUBLISHED'")?.c);
  },
};

/* ========================================================================== */
/* Elements (DB-extended catalogue)                                            */
/* ========================================================================== */

export const elements = {
  list(opts: { category?: string; search?: string; limit?: number; offset?: number } = {}) {
    const where = ["status = 'PUBLISHED'"];
    const values: any[] = [];
    if (opts.category && opts.category !== 'ALL') {
      where.push('category = ?');
      values.push(opts.category);
    }
    if (opts.search) {
      where.push('(name LIKE ? OR tags LIKE ?)');
      const t = `%${opts.search}%`;
      values.push(t, t);
    }
    return all<any>(
      `SELECT * FROM elements WHERE ${where.join(' AND ')} ORDER BY usage_count DESC, name LIMIT ? OFFSET ?`,
      [...values, Math.min(opts.limit ?? 120, 400), opts.offset ?? 0],
    ).map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      category: r.category,
      subcategory: r.subcategory,
      tags: parseJson<string[]>(r.tags, []),
      svg: r.svg,
      colors: parseJson<string[]>(r.colors, []),
      width: int(r.width, 100),
      height: int(r.height, 100),
      license: r.license,
    }));
  },
  count(): number {
    return int(get<{ c: number }>("SELECT COUNT(*) as c FROM elements WHERE status = 'PUBLISHED'")?.c);
  },
};

/* ========================================================================== */
/* Collaboration: shares, comments, activity, ops                              */
/* ========================================================================== */

export const shares = {
  forProject(projectId: string) {
    return all<any>(
      `SELECT s.*, u.name as user_name, u.email as user_email, u.avatar_url as user_avatar
       FROM shares s LEFT JOIN users u ON u.id = s.user_id WHERE s.project_id = ? ORDER BY s.created_at`,
      [projectId],
    ).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      userId: r.user_id,
      email: r.email ?? r.user_email,
      role: r.role as Role,
      userName: r.user_name,
      userAvatar: r.user_avatar,
      createdAt: int(r.created_at),
    }));
  },
  add(projectId: string, input: { userId?: string | null; email?: string | null; role: Role; grantedBy?: string | null }): void {
    const existing = get('SELECT id FROM shares WHERE project_id = ? AND (user_id = ? OR email = ?)', [
      projectId,
      input.userId ?? null,
      input.email ?? null,
    ]);
    if (existing) {
      run('UPDATE shares SET role = ? WHERE id = ?', [input.role, (existing as any).id]);
      return;
    }
    run('INSERT INTO shares (id, project_id, user_id, email, role, granted_by, created_at) VALUES (?,?,?,?,?,?,?)', [
      newId('shr'),
      projectId,
      input.userId ?? null,
      input.email ?? null,
      input.role,
      input.grantedBy ?? null,
      now(),
    ]);
  },
  remove(projectId: string, id: string): void {
    run('DELETE FROM shares WHERE project_id = ? AND id = ?', [projectId, id]);
  },
};

export const comments = {
  forProject(projectId: string) {
    return all<any>(
      `SELECT c.*, u.name as author_name, u.avatar_url as author_avatar FROM comments c
       JOIN users u ON u.id = c.author_id WHERE c.project_id = ? ORDER BY c.created_at ASC`,
      [projectId],
    ).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      pageId: r.page_id,
      nodeId: r.node_id,
      authorId: r.author_id,
      authorName: r.author_name,
      authorAvatar: r.author_avatar,
      parentId: r.parent_id,
      body: r.body,
      mentions: parseJson<string[]>(r.mentions, []),
      resolved: bool(r.resolved),
      x: r.x == null ? null : Number(r.x),
      y: r.y == null ? null : Number(r.y),
      createdAt: int(r.created_at),
    }));
  },
  add(input: {
    projectId: string;
    authorId: string;
    body: string;
    parentId?: string | null;
    pageId?: string | null;
    nodeId?: string | null;
    mentions?: string[];
    x?: number | null;
    y?: number | null;
  }) {
    const id = newId('cmt');
    run(
      `INSERT INTO comments (id, project_id, page_id, node_id, author_id, parent_id, body, mentions, x, y, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.projectId,
        input.pageId ?? null,
        input.nodeId ?? null,
        input.authorId,
        input.parentId ?? null,
        input.body,
        stringifyJson(input.mentions ?? []),
        input.x ?? null,
        input.y ?? null,
        now(),
        now(),
      ],
    );
    return id;
  },
  update(id: string, patch: { body?: string; resolved?: boolean }): void {
    const sets: string[] = [];
    const values: any[] = [];
    if (patch.body !== undefined) {
      sets.push('body = ?');
      values.push(patch.body);
    }
    if (patch.resolved !== undefined) {
      sets.push('resolved = ?');
      values.push(patch.resolved ? 1 : 0);
    }
    if (!sets.length) return;
    sets.push('updated_at = ?');
    values.push(now(), id);
    run(`UPDATE comments SET ${sets.join(', ')} WHERE id = ?`, values);
  },
  remove(id: string): void {
    run('DELETE FROM comments WHERE id = ?', [id]);
  },
};

export const activity = {
  log(projectId: string, userId: string | null, type: string, meta: unknown = {}): void {
    if (!projectId) return; // global events are not stored in the project feed
    run('INSERT INTO activity (id, project_id, user_id, type, meta, created_at) VALUES (?,?,?,?,?,?)', [
      newId('act'),
      projectId,
      userId,
      type,
      stringifyJson(meta),
      now(),
    ]);
  },
  forProject(projectId: string, limit = 50) {
    return all<any>(
      `SELECT a.*, u.name as user_name, u.avatar_url as user_avatar FROM activity a
       LEFT JOIN users u ON u.id = a.user_id WHERE a.project_id = ? ORDER BY a.created_at DESC LIMIT ?`,
      [projectId, limit],
    ).map((r) => ({
      id: r.id,
      type: r.type,
      meta: parseJson(r.meta, {}),
      createdAt: int(r.created_at),
      userId: r.user_id,
      userName: r.user_name,
      userAvatar: r.user_avatar,
    }));
  },
};

export const ops = {
  /** Appends an op and returns its monotonic sequence number. */
  append(projectId: string, userId: string | null, type: string, payload: unknown): number {
    const last = get<{ seq: number }>('SELECT MAX(seq) as seq FROM collab_ops WHERE project_id = ?', [projectId]);
    const seq = int(last?.seq) + 1;
    run('INSERT INTO collab_ops (id, project_id, user_id, seq, type, payload, created_at) VALUES (?,?,?,?,?,?,?)', [
      newId('op'),
      projectId,
      userId,
      seq,
      type,
      stringifyJson(payload),
      now(),
    ]);
    // Bound the op log: keep the most recent 2000 ops per project.
    run(
      `DELETE FROM collab_ops WHERE project_id = ? AND seq <= ?`,
      [projectId, Math.max(0, seq - 2000)],
    );
    return seq;
  },
  since(projectId: string, seq: number, limit = 200) {
    return all<any>('SELECT * FROM collab_ops WHERE project_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?', [projectId, seq, limit]).map(
      (r) => ({
        seq: int(r.seq),
        type: r.type,
        payload: parseJson(r.payload, {}),
        userId: r.user_id,
        createdAt: int(r.created_at),
      }),
    );
  },
  latest(projectId: string): number {
    return int(get<{ seq: number }>('SELECT MAX(seq) as seq FROM collab_ops WHERE project_id = ?', [projectId])?.seq);
  },
};

/* ========================================================================== */
/* Usage metering & admin                                                      */
/* ========================================================================== */

export const usage = {
  record(userId: string, kind: string, amount = 1, meta: unknown = {}): void {
    run('INSERT INTO usage (id, user_id, kind, amount, meta, created_at) VALUES (?,?,?,?,?,?)', [
      newId('usg'),
      userId,
      kind,
      amount,
      stringifyJson(meta),
      now(),
    ]);
    if (kind.startsWith('AI_')) {
      run('UPDATE users SET ai_credits = MAX(0, ai_credits - ?) WHERE id = ?', [amount, userId]);
    }
  },
  summary(userId: string, sinceDays = 30) {
    const since = now() - sinceDays * 24 * 60 * 60 * 1000;
    return all<{ kind: string; total: number }>(
      'SELECT kind, SUM(amount) as total FROM usage WHERE user_id = ? AND created_at > ? GROUP BY kind ORDER BY total DESC',
      [userId, since],
    );
  },
  global(sinceDays = 30) {
    const since = now() - sinceDays * 24 * 60 * 60 * 1000;
    return all<{ kind: string; total: number; users: number }>(
      'SELECT kind, SUM(amount) as total, COUNT(DISTINCT user_id) as users FROM usage WHERE created_at > ? GROUP BY kind ORDER BY total DESC',
      [since],
    );
  },
};

export const admin = {
  stats() {
    const q = (sql: string) => int(get<{ c: number }>(sql)?.c);
    return {
      users: q('SELECT COUNT(*) as c FROM users'),
      newUsers7d: q(`SELECT COUNT(*) as c FROM users WHERE created_at > ${now() - 7 * 86400000}`),
      projects: q('SELECT COUNT(*) as c FROM projects'),
      projectsTrashed: q('SELECT COUNT(*) as c FROM projects WHERE trashed = 1'),
      templates: q("SELECT COUNT(*) as c FROM templates WHERE status = 'PUBLISHED'"),
      elements: q("SELECT COUNT(*) as c FROM elements WHERE status = 'PUBLISHED'"),
      assets: q('SELECT COUNT(*) as c FROM assets'),
      storageBytes: int(get<{ s: number }>('SELECT COALESCE(SUM(size),0) as s FROM assets')?.s),
      comments: q('SELECT COUNT(*) as c FROM comments'),
      versions: q('SELECT COUNT(*) as c FROM versions'),
      openReports: q("SELECT COUNT(*) as c FROM reports WHERE status = 'OPEN'"),
      aiUsage: usage.global(30),
    };
  },
  reports(status = 'OPEN') {
    return all<any>(
      `SELECT r.*, u.name as author_name FROM reports r LEFT JOIN users u ON u.id = r.author_id
       WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 100`,
      [status],
    ).map((r) => ({
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      authorName: r.author_name,
      createdAt: int(r.created_at),
    }));
  },
  resolveReport(id: string, status: 'RESOLVED' | 'DISMISSED', moderatorId: string): void {
    run('UPDATE reports SET status = ?, moderator_id = ?, resolved_at = ? WHERE id = ?', [status, moderatorId, now(), id]);
  },
};

/* ========================================================================== */
/* Favorites                                                                   */
/* ========================================================================== */

export const favorites = {
  list(userId: string, kind: string): string[] {
    return all<{ ref_id: string }>('SELECT ref_id FROM favorites WHERE user_id = ? AND kind = ? ORDER BY created_at DESC', [
      userId,
      kind,
    ]).map((r) => r.ref_id);
  },
  toggle(userId: string, kind: string, refId: string): boolean {
    const existing = get('SELECT id FROM favorites WHERE user_id = ? AND kind = ? AND ref_id = ?', [userId, kind, refId]);
    if (existing) {
      run('DELETE FROM favorites WHERE user_id = ? AND kind = ? AND ref_id = ?', [userId, kind, refId]);
      return false;
    }
    run('INSERT INTO favorites (id, user_id, kind, ref_id, created_at) VALUES (?,?,?,?,?)', [newId('fav'), userId, kind, refId, now()]);
    return true;
  },
};

/* ========================================================================== */
/* Search                                                                      */
/* ========================================================================== */

export const search = {
  /** Unified search across a user's own content plus the public catalogues. */
  everything(userId: string, term: string, limit = 8) {
    const like = `%${term}%`;
    const projects = all<any>(
      'SELECT id, title, kind, updated_at FROM projects WHERE owner_id = ? AND trashed = 0 AND title LIKE ? ORDER BY updated_at DESC LIMIT ?',
      [userId, like, limit],
    ).map((r) => ({ id: r.id, title: r.title, type: 'project' as const, meta: r.kind, updatedAt: int(r.updated_at) }));

    const media = all<any>(
      'SELECT id, name, kind FROM assets WHERE owner_id = ? AND name LIKE ? ORDER BY updated_at DESC LIMIT ?',
      [userId, like, limit],
    ).map((r) => ({ id: r.id, title: r.name, type: 'asset' as const, meta: r.kind, updatedAt: 0 }));

    const tpl = all<any>(
      "SELECT id, name, category FROM templates WHERE status = 'PUBLISHED' AND (name LIKE ? OR tags LIKE ? OR category LIKE ?) ORDER BY usage_count DESC LIMIT ?",
      [like, like, like, limit],
    ).map((r) => ({ id: r.id, title: r.name, type: 'template' as const, meta: r.category, updatedAt: 0 }));

    const el = elements.list({ search: term, limit });
    const elResults = el.map((e) => ({ id: e.id, title: e.name, type: 'element' as const, meta: e.category, updatedAt: 0 }));

    return { projects, media, templates: tpl, elements: elResults };
  },
};

export { db, slugify, newId, all, get, run, tx };
