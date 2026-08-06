import { MiddlewareFunction, RouteContext } from './types.js';

export interface RateLimitOptions {
  /** Window duration in ms. Default 60_000 (1 minute). */
  windowMs?: number;
  /** Max requests allowed per window per key. Default 100. */
  max?: number;
  /** Groups requests into a bucket. Defaults to the client's remote address. */
  keyGenerator?: (ctx: RouteContext) => string;
  /** Called instead of the default 429 when the limit is hit. Must write its own response. */
  onLimitReached?: (ctx: RouteContext) => void | Promise<void>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

function defaultKey(ctx: RouteContext): string {
  return ctx.res.remoteAddressText() ?? 'unknown';
}

/**
 * Fixed-window, in-memory rate limiting middleware. Opt-in via
 * `.use(rateLimit(...))` on whichever app/sub-app needs it - not applied
 * globally by the framework.
 */
export function rateLimit(options: RateLimitOptions = {}): MiddlewareFunction {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 100;
  const keyGenerator = options.keyGenerator ?? defaultKey;
  const buckets = new Map<string, Bucket>();

  return async (ctx, next) => {
    const key = keyGenerator(ctx);
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;

    if (bucket.count > max) {
      if (options.onLimitReached) {
        await options.onLimitReached(ctx);
        return;
      }

      if (!ctx.res.aborted) {
        ctx.res.writeStatus('429 Too Many Requests');
        ctx.res.writeHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
        ctx.res.end('Too Many Requests');
      }
      return;
    }

    await next();
  };
}
