import { MiddlewareFunction, RouteContext } from './types.js';

export interface SessionAuthOptions {
  /** Key to check in ctx.session. Defaults to 'user'. */
  key?: string;
  /** Optional custom validation for the session value. */
  validate?: (value: unknown, ctx: RouteContext) => boolean | Promise<boolean>;
  /** Response message for default unauthorized reply. */
  message?: string;
  /** Value for WWW-Authenticate realm when returning 401. */
  realm?: string;
  /** Custom unauthorized handler. If provided, default response is skipped. */
  onUnauthorized?: (ctx: RouteContext) => void | Promise<void>;
}

export interface BearerAuthOptions {
  /**
   * Optional token verifier.
   * If omitted, any non-empty bearer token is accepted.
   */
  verifyToken?: (token: string, ctx: RouteContext) => boolean | Promise<boolean>;
  /** Allow missing token and continue middleware chain. */
  optional?: boolean;
  /** Response message for default unauthorized reply. */
  message?: string;
  /** Value for WWW-Authenticate realm when returning 401. */
  realm?: string;
  /** Custom unauthorized handler. If provided, default response is skipped. */
  onUnauthorized?: (ctx: RouteContext) => void | Promise<void>;
  /** Called after successful auth. */
  onAuthorized?: (ctx: RouteContext, token: string) => void | Promise<void>;
}

export interface BasicAuthOptions {
  /** Credential verifier, required for basic auth middleware. */
  verifyCredentials: (username: string, password: string, ctx: RouteContext) => boolean | Promise<boolean>;
  /** Allow missing/invalid header and continue middleware chain. */
  optional?: boolean;
  /** Response message for default unauthorized reply. */
  message?: string;
  /** Value for WWW-Authenticate realm when returning 401. */
  realm?: string;
  /** Custom unauthorized handler. If provided, default response is skipped. */
  onUnauthorized?: (ctx: RouteContext) => void | Promise<void>;
  /** Called after successful auth. */
  onAuthorized?: (ctx: RouteContext, username: string) => void | Promise<void>;
}

export interface BasicCredentials {
  username: string;
  password: string;
}

function writeUnauthorized(ctx: RouteContext, message: string, realm?: string, scheme?: 'Bearer' | 'Basic'): void {
  if (scheme) {
    const challenge = realm ? `${scheme} realm="${realm}"` : scheme;
    ctx.res.writeHeader('WWW-Authenticate', challenge);
  }

  ctx.res.writeStatus('401 Unauthorized');
  ctx.res.writeHeader('Content-Type', 'application/json');
  ctx.res.end(JSON.stringify({ error: 'Unauthorized', message }));
}

/** Return the raw Authorization header, if present. */
export function getAuthorizationHeader(ctx: RouteContext): string | undefined {
  const value = ctx.req.getHeader('authorization');
  return value || undefined;
}

/** Parse an Authorization bearer token from the request. */
export function getBearerToken(ctx: RouteContext): string | undefined {
  const header = getAuthorizationHeader(ctx);
  if (!header) return undefined;

  const [scheme, token] = header.split(/\s+/, 2);
  if (!scheme || !token) return undefined;
  if (scheme.toLowerCase() !== 'bearer') return undefined;

  const cleanToken = token.trim();
  return cleanToken.length > 0 ? cleanToken : undefined;
}

/** Parse Basic auth credentials from the Authorization header. */
export function getBasicCredentials(ctx: RouteContext): BasicCredentials | undefined {
  const header = getAuthorizationHeader(ctx);
  if (!header) return undefined;

  const [scheme, encoded] = header.split(/\s+/, 2);
  if (!scheme || !encoded) return undefined;
  if (scheme.toLowerCase() !== 'basic') return undefined;

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator === -1) return undefined;

    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    if (!username) return undefined;

    return { username, password };
  } catch {
    return undefined;
  }
}

/** Middleware helper that requires a session value (ctx.session[key]). */
export function requireSessionAuth(options: SessionAuthOptions = {}): MiddlewareFunction {
  const key = options.key ?? 'user';
  const message = options.message ?? 'Session authentication required';

  return async (ctx, next) => {
    const value = ctx.session?.[key];
    const authorized = options.validate ? await options.validate(value, ctx) : value !== undefined && value !== null;

    if (!authorized) {
      if (options.onUnauthorized) {
        await options.onUnauthorized(ctx);
      } else {
        writeUnauthorized(ctx, message, options.realm);
      }
      return;
    }

    await next();
  };
}

/** Middleware helper that checks Authorization: Bearer <token>. */
export function requireBearerAuth(options: BearerAuthOptions = {}): MiddlewareFunction {
  const message = options.message ?? 'Bearer token required';

  return async (ctx, next) => {
    const token = getBearerToken(ctx);

    if (!token) {
      if (options.optional) {
        await next();
        return;
      }

      if (options.onUnauthorized) {
        await options.onUnauthorized(ctx);
      } else {
        writeUnauthorized(ctx, message, options.realm, 'Bearer');
      }
      return;
    }

    const valid = options.verifyToken ? await options.verifyToken(token, ctx) : true;
    if (!valid) {
      if (options.optional) {
        await next();
        return;
      }

      if (options.onUnauthorized) {
        await options.onUnauthorized(ctx);
      } else {
        writeUnauthorized(ctx, message, options.realm, 'Bearer');
      }
      return;
    }

    if (options.onAuthorized) {
      await options.onAuthorized(ctx, token);
    }

    await next();
  };
}

/** Middleware helper that checks Authorization: Basic <base64>. */
export function requireBasicAuth(options: BasicAuthOptions): MiddlewareFunction {
  const message = options.message ?? 'Basic authentication required';

  return async (ctx, next) => {
    const credentials = getBasicCredentials(ctx);

    if (!credentials) {
      if (options.optional) {
        await next();
        return;
      }

      if (options.onUnauthorized) {
        await options.onUnauthorized(ctx);
      } else {
        writeUnauthorized(ctx, message, options.realm, 'Basic');
      }
      return;
    }

    const valid = await options.verifyCredentials(credentials.username, credentials.password, ctx);
    if (!valid) {
      if (options.optional) {
        await next();
        return;
      }

      if (options.onUnauthorized) {
        await options.onUnauthorized(ctx);
      } else {
        writeUnauthorized(ctx, message, options.realm, 'Basic');
      }
      return;
    }

    if (options.onAuthorized) {
      await options.onAuthorized(ctx, credentials.username);
    }

    await next();
  };
}
