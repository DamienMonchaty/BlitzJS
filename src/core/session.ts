import { MiddlewareFunction } from './types.js';
import { CookieOptions } from './cookie.js';
import { defaultRuntimeServices } from './platform.js';

/** Pluggable session storage backend. Swap `MemoryStore` for Redis/DB in production. */
export interface SessionStore {
  get(id: string): Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;
  set(id: string, data: Record<string, unknown>, maxAge?: number): Promise<void> | void;
  destroy(id: string): Promise<void> | void;
}

/** Default in-memory store. Data is lost on restart and not shared across processes/workers. */
export class MemoryStore implements SessionStore {
  private data = new Map<string, { value: Record<string, unknown>; expiresAt?: number }>();

  get(id: string): Record<string, unknown> | undefined {
    const entry = this.data.get(id);
    if (!entry) return undefined;

    if (entry.expiresAt !== undefined && entry.expiresAt < Date.now()) {
      this.data.delete(id);
      return undefined;
    }

    return entry.value;
  }

  set(id: string, value: Record<string, unknown>, maxAge?: number): void {
    this.data.set(id, { value, expiresAt: maxAge !== undefined ? Date.now() + maxAge * 1000 : undefined });
  }

  destroy(id: string): void {
    this.data.delete(id);
  }
}

export interface SessionOptions {
  /** Storage backend. Defaults to an in-memory `Map` (single-process only). */
  store?: SessionStore;
  /** Name of the cookie carrying the session id. Default `'blitz.sid'`. */
  cookieName?: string;
  /** Session lifetime in seconds. Default 1 day. */
  maxAge?: number;
  cookieOptions?: Omit<CookieOptions, 'maxAge'>;
  /** Override session ID generation for non-Node runtimes or custom formats. */
  generateId?: () => string;
}

/**
 * Session middleware. Reads/creates a session id cookie, loads its data from
 * `store` into `ctx.session`, and persists whatever the handler mutated on
 * `ctx.session` back to `store` after the request completes.
 */
export function session(options: SessionOptions = {}): MiddlewareFunction {
  const store = options.store ?? new MemoryStore();
  const cookieName = options.cookieName ?? 'blitz.sid';
  const maxAge = options.maxAge ?? 60 * 60 * 24;
  const generateId = options.generateId ?? defaultRuntimeServices.randomId;

  return async (ctx, next) => {
    let id = ctx.cookies[cookieName];
    let data = id ? await store.get(id) : undefined;

    if (!id || data === undefined) {
      id = generateId();
      data = {};
    }

    ctx.session = data;
    // Set the cookie before the handler runs: the response is often ended
    // (and its headers flushed) inside `next()`, so writing it afterwards
    // would silently be dropped.
    ctx.setCookie(cookieName, id, { httpOnly: true, path: '/', maxAge, ...options.cookieOptions });

    await next();

    await store.set(id, ctx.session, maxAge);
  };
}
