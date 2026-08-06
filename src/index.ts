// BlitzJS - Ultra-lightweight, Elysia-like web framework
export {
  BlitzJS,
  cors,
  errorHandler,
  staticFile,
  session,
  MemoryStore,
  rateLimit,
  requireSessionAuth,
  requireBearerAuth,
  requireBasicAuth,
  getAuthorizationHeader,
  getBearerToken,
  getBasicCredentials,
  database,
  getDatabase,
  requireDatabase,
  generateOpenApiDocument,
  swagger,
  type PluginFunction,
  type BlitzConfig,
  type RouteContext,
  type RouteHandlerFunction,
  type MiddlewareFunction,
  type HttpMethod,
  type SimpleResponse,
  type SimpleHandlerFunction,
  type SimpleHandler,
  type CookieOptions,
  type CorsOptions,
  type ErrorHandlerOptions,
  type MultipartFile,
  type MultipartBody,
  type SessionOptions,
  type SessionStore,
  type RateLimitOptions,
  type SessionAuthOptions,
  type BearerAuthOptions,
  type BasicAuthOptions,
  type BasicCredentials,
  type DatabaseFactory,
  type DatabaseOptions,
  type OpenApiInfo,
  type OpenApiServer,
  type OpenApiOptions,
  type OpenApiOperationMeta,
  type SwaggerOptions,
  type RouteSchema,
  type ValidatedRouteContext,
  type ValidatedHandlerFunction
} from './core/BlitzJS.js';

export type { RuntimeRequest, RuntimeResponse } from './core/runtime.js';

// Runtime adapters - uWebSockets.js's adapter is intentionally not re-exported
// here (importing it eagerly loads a native binary that crashes under Bun);
// import it directly from '@damienmonchaty/blitzjs/dist/adapters/uws.js' if needed.
export { serveWithNode, type NodeServeOptions, type NodeLikeServer } from './adapters/node.js';
export { serveWithBun, type BunServeOptions } from './adapters/bun.js';
export { createFetchHandler, type FetchDispatchApp } from './adapters/fetch.js';
export type { FetchHandler, ServeOptions } from './adapters/types.js';
