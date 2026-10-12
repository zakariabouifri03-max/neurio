/** A tiny path-pattern router — no express, no dependencies. */
import { HttpError } from '../ids';
import type { Handler, RestDeps, RouteContext, RouteOptions } from './types';

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  options: RouteOptions;
}

export class Router {
  #routes: Route[] = [];

  add(method: string, path: string, handler: Handler, options: RouteOptions = {}): this {
    const segments = path.split('/').filter((s) => s.length > 0);
    this.#routes.push({ method: method.toUpperCase(), segments, handler, options });
    return this;
  }

  get(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add('GET', path, handler, options);
  }
  post(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add('POST', path, handler, options);
  }
  patch(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add('PATCH', path, handler, options);
  }
  put(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add('PUT', path, handler, options);
  }
  delete(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add('DELETE', path, handler, options);
  }

  match(method: string, segments: string[]): { route: Route; params: Record<string, string> } | null {
    let methodMismatch = false;
    for (const route of this.#routes) {
      if (route.segments.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const pattern = route.segments[i];
        const value = segments[i];
        if (pattern.startsWith(':')) {
          if (!value) {
            matched = false;
            break;
          }
          params[pattern.slice(1)] = decodeURIComponent(value);
        } else if (pattern !== value) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      if (route.method !== method) {
        methodMismatch = true;
        continue;
      }
      return { route, params };
    }
    if (methodMismatch) throw new HttpError(405, 'Method not allowed for this path', 'method_not_allowed');
    return null;
  }

  routes(): { method: string; path: string; auth: boolean }[] {
    return this.#routes.map((route) => ({
      method: route.method,
      path: `/${route.segments.join('/')}`,
      auth: route.options.auth !== false,
    }));
  }
}

export interface MatchedRoute {
  handler: Handler;
  options: RouteOptions;
  params: Record<string, string>;
}

export function createMatcher(router: Router) {
  return (method: string, segments: string[]): MatchedRoute | null => {
    const found = router.match(method, segments);
    if (!found) return null;
    return { handler: found.route.handler, options: found.route.options, params: found.params };
  };
}

export type { RouteContext, RestDeps };
