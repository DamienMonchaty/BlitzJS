import { MiddlewareFunction, RouteContext } from './types.js';

export type DatabaseFactory<T> = (ctx: RouteContext) => T | Promise<T>;

export interface DatabaseOptions {
  /** Storage key in ctx.state. Defaults to 'db'. */
  name?: string;
  /**
   * Cache strategy:
   * - request: resolve for each request
   * - global: resolve once and reuse for all requests (useful for pools/clients)
   */
  cache?: 'request' | 'global';
}

/**
 * Register any database client in request context without coupling BlitzJS to
 * a specific driver/ORM.
 */
export function database<T>(clientOrFactory: T | DatabaseFactory<T>, options: DatabaseOptions = {}): MiddlewareFunction {
  const name = options.name ?? 'db';
  const cache = options.cache ?? 'global';

  let hasGlobalValue = false;
  let globalValue: T | undefined;

  return async (ctx, next) => {
    if (cache === 'global') {
      if (!hasGlobalValue) {
        globalValue = typeof clientOrFactory === 'function'
          ? await (clientOrFactory as DatabaseFactory<T>)(ctx)
          : clientOrFactory;
        hasGlobalValue = true;
      }

      ctx.state[name] = globalValue;
      await next();
      return;
    }

    const value = typeof clientOrFactory === 'function'
      ? await (clientOrFactory as DatabaseFactory<T>)(ctx)
      : clientOrFactory;

    ctx.state[name] = value;
    await next();
  };
}

/** Get an optional database client from ctx.state. */
export function getDatabase<T = unknown>(ctx: RouteContext, name = 'db'): T | undefined {
  return ctx.state[name] as T | undefined;
}

/** Get a required database client from ctx.state or throw. */
export function requireDatabase<T = unknown>(ctx: RouteContext, name = 'db'): T {
  const value = getDatabase<T>(ctx, name);
  if (value === undefined) {
    throw new Error(`Database '${name}' is not registered on this request context.`);
  }
  return value;
}
