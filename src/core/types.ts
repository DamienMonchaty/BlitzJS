import type { CookieOptions } from './cookie.js';
import type { RuntimeRequest, RuntimeResponse } from './runtime.js';

export type { CookieOptions } from './cookie.js';
export type { CorsOptions } from './cors.js';

/** Supported HTTP methods */
export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';

/**
 * Context object passed to route handlers and middlewares
 * Contains request/response objects and extracted parameters
 */
export interface RouteContext {
  /** Runtime-agnostic request object (see `RuntimeRequest`) */
  req: RuntimeRequest;
  /** Runtime-agnostic response object (see `RuntimeResponse`) */
  res: RuntimeResponse;
  /** Arbitrary per-request state bag for plugins/integrations (db clients, auth payloads, etc.). */
  state: Record<string, unknown>;
  /** URL parameters extracted from the route pattern (e.g., :id) */
  params: Record<string, string>;
  /** Query string parameters */
  query: Record<string, string>;
  /** Request body (if parsed) */
  body?: unknown;
  /** Cookies parsed from the `Cookie` request header */
  cookies: Record<string, string>;
  /** Append a `Set-Cookie` header to the response */
  setCookie: (name: string, value: string, options?: CookieOptions) => void;
  /** Session data, present only when the `session()` middleware is registered */
  session?: Record<string, unknown>;
}

/** Traditional route handler function that manually manages the response */
export type RouteHandlerFunction = (ctx: RouteContext) => void | Promise<void>;

/** Middleware function with next() callback for chaining */
export type MiddlewareFunction = (ctx: RouteContext, next: () => Promise<void>) => void | Promise<void>;

/** Simple response types that can be automatically serialized */
export type SimpleResponse = string | number | boolean | null | Record<string, unknown> | unknown[];

/** Simple handler function that returns a value (supports auto-serialization) */
export type SimpleHandlerFunction = (ctx: RouteContext) => SimpleResponse | Promise<SimpleResponse>;

/** Union type for both simple responses and handler functions */
export type SimpleHandler = SimpleResponse | SimpleHandlerFunction | RouteHandlerFunction;

/** Configuration options for a BlitzJS application */
export interface BlitzConfig {
  /** Server port (default: 3000) */
  port?: number;
  /** Server host (default: '0.0.0.0') */
  host?: string;
  /** Prefix for sub-application mounting */
  prefix?: string;
}

/** Internal route structure with optimization metadata */
export interface Route {
  /** HTTP method for this route */
  method: HttpMethod;
  /** Original route pattern (e.g., '/users/:id') */
  pattern: string;
  /** Compiled route handler function */
  handler: RouteHandlerFunction;
  /** Compiled regex for pattern matching */
  regex: RegExp;
  /** Names of parameters extracted from the pattern */
  paramNames: string[];
  /** Compiled optimized handler for runtime code generation (unified (ctx) => ... signature) */
  compiledHandler?: RouteHandlerFunction;
  /** Whether this is a static route (no parameters) */
  isStatic?: boolean;
  /** Original handler before compilation (for debugging) */
  originalHandler?: SimpleHandler | RouteHandlerFunction;
  /** Optional per-route input validation, checked before the handler runs */
  schema?: import('./validation.js').RouteSchema;
}

/** Snapshot of a registered route's public shape, for tooling like `generateOpenApiDocument` */
export interface RouteInfo {
  method: HttpMethod;
  pattern: string;
  paramNames: string[];
  schema?: import('./validation.js').RouteSchema;
}
