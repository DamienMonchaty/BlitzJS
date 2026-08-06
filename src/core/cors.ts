import { MiddlewareFunction } from './types.js';

export interface CorsOptions {
  /** Allowed origin(s). `'*'` (default), a fixed string, a whitelist, or a predicate/mapper */
  origin?: string | string[] | ((requestOrigin: string) => boolean | string);
  methods?: string[];
  allowedHeaders?: string[];
  credentials?: boolean;
  /** Preflight cache duration in seconds, sent as `Access-Control-Max-Age` */
  maxAge?: number;
}

function resolveOrigin(origin: CorsOptions['origin'], requestOrigin: string): string | null {
  if (origin === undefined || origin === '*') return '*';
  if (typeof origin === 'string') return origin;
  if (Array.isArray(origin)) return origin.includes(requestOrigin) ? requestOrigin : null;

  const result = origin(requestOrigin);
  if (result === true) return requestOrigin;
  if (typeof result === 'string') return result;
  return null;
}

/**
 * CORS middleware. Sets `Access-Control-Allow-*` headers on every request
 * and short-circuits `OPTIONS` preflight requests with a `204`.
 *
 * `writeStatus` must run before any `writeHeader` call on the same
 * response - uWebSockets.js locks the status at the first header write.
 */
export function cors(options: CorsOptions = {}): MiddlewareFunction {
  const methods = (options.methods ?? ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']).join(', ');
  const allowedHeaders = (options.allowedHeaders ?? ['Content-Type', 'Authorization']).join(', ');

  return async (ctx, next) => {
    const requestOrigin = ctx.req.getHeader('origin');
    const allowOrigin = resolveOrigin(options.origin, requestOrigin);
    const isPreflight = ctx.req.getMethod().toUpperCase() === 'OPTIONS';

    if (isPreflight) {
      ctx.res.writeStatus('204 No Content');
    }

    if (allowOrigin) {
      ctx.res.writeHeader('Access-Control-Allow-Origin', allowOrigin);
      if (options.credentials) ctx.res.writeHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (isPreflight) {
      ctx.res.writeHeader('Access-Control-Allow-Methods', methods);
      ctx.res.writeHeader('Access-Control-Allow-Headers', allowedHeaders);
      if (options.maxAge !== undefined) ctx.res.writeHeader('Access-Control-Max-Age', String(options.maxAge));
      ctx.res.end();
      return;
    }

    await next();
  };
}
