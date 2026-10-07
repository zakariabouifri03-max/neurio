/**
 * Role / permission model shared by the API, the editor and the admin panel.
 * Kept in one place so authorization can never drift between routes.
 */

export const ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const PLANS = ['FREE', 'PRO', 'TEAM', 'ENTERPRISE'] as const;
export type Plan = (typeof PLANS)[number];

export const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2,
  OWNER: 3,
};

export const PLAN_RANK: Record<Plan, number> = {
  FREE: 0,
  PRO: 1,
  TEAM: 2,
  ENTERPRISE: 3,
};

export function atLeast(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export function isAdmin(user: { role: string } | null): boolean {
  return !!user && (user.role === 'ADMIN' || user.role === 'OWNER');
}

export const PERMISSIONS: Record<string, Role> = {
  'project:view': 'VIEWER',
  'project:comment': 'VIEWER',
  'project:edit': 'EDITOR',
  'project:delete': 'OWNER',
  'project:share': 'OWNER',
  'project:restore': 'EDITOR',
  'admin:access': 'ADMIN',
};

export function can(role: Role, permission: keyof typeof PERMISSIONS | string): boolean {
  const required = PERMISSIONS[permission] ?? 'OWNER';
  return atLeast(role, required);
}

export type PlanLimits = {
  storageBytes: number;
  aiCreditsPerMonth: number;
  maxProjects: number;
  exportMaxScale: number;
  videoExport: boolean;
  fourK: boolean;
  brandKits: number;
  removeWatermark: boolean;
  collaboration: boolean;
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: {
    storageBytes: 1 * 1024 * 1024 * 1024,
    aiCreditsPerMonth: 200,
    maxProjects: 100,
    exportMaxScale: 2,
    videoExport: true,
    fourK: false,
    brandKits: 1,
    removeWatermark: true,
    collaboration: true,
  },
  PRO: {
    storageBytes: 100 * 1024 * 1024 * 1024,
    aiCreditsPerMonth: 5000,
    maxProjects: -1,
    exportMaxScale: 4,
    videoExport: true,
    fourK: true,
    brandKits: 10,
    removeWatermark: true,
    collaboration: true,
  },
  TEAM: {
    storageBytes: 1024 * 1024 * 1024 * 1024,
    aiCreditsPerMonth: 20000,
    maxProjects: -1,
    exportMaxScale: 4,
    videoExport: true,
    fourK: true,
    brandKits: 100,
    removeWatermark: true,
    collaboration: true,
  },
  ENTERPRISE: {
    storageBytes: 10 * 1024 * 1024 * 1024 * 1024,
    aiCreditsPerMonth: 1000000,
    maxProjects: -1,
    exportMaxScale: 8,
    videoExport: true,
    fourK: true,
    brandKits: 1000,
    removeWatermark: true,
    collaboration: true,
  },
};

export function limitsFor(plan: string): PlanLimits {
  return PLAN_LIMITS[(plan as Plan) in PLAN_LIMITS ? (plan as Plan) : 'FREE'];
}
