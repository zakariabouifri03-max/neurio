/** Composes every REST route group into one router. */
import { Router } from './router';
import { registerAuthRoutes } from './auth';
import { registerUserRoutes } from './users';
import { registerGuildRoutes } from './guilds';
import { registerChannelRoutes } from './channels';
import { registerMessageRoutes } from './messages';
import { registerFileRoutes } from './files';
import { registerAdminRoutes } from './admin';
import type { RestDeps } from './types';

export type { RestDeps, RouteContext, Handler } from './types';
export { Router } from './router';

export function createRouter(deps: RestDeps): Router {
  const router = new Router();
  registerAuthRoutes(router, deps);
  registerUserRoutes(router, deps);
  registerGuildRoutes(router, deps);
  registerChannelRoutes(router, deps);
  registerMessageRoutes(router, deps);
  registerFileRoutes(router, deps);
  registerAdminRoutes(router, deps);
  return router;
}
