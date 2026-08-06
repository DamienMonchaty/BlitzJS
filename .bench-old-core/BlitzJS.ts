/**
 * BlitzJS - Ultra-lightweight, high-performance web framework
 *
 * Built on top of uWebSockets.js for maximum performance, featuring runtime
 * code generation, template pattern handlers, and ultra-fast routing.
 *
 * Key Features:
 * - Runtime code generation for maximum performance
 * - O(1) static route lookup using HashMap
 * - Optimized regex matching for dynamic routes
 * - Template pattern handlers without closures
 * - Support for sub-applications with prefix mounting
 * - Simple and intuitive handler API with auto-serialization
 * - Middleware chain with next()
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import { App, SSLApp, TemplatedApp, HttpRequest, HttpResponse } from 'uWebSockets.js';
import {
  BlitzConfig,
  HttpMethod,
  MiddlewareFunction,
  Route,
  RouteContext,
  RouteHandlerFunction,
  SimpleHandler
} from './types.js';
import { compilePattern } from './pattern.js';
import { createSimpleHandler } from './simple-handler.js';
import { compileOptimizedHandler } from './templates.js';
import { runMiddlewares } from './middleware.js';
import { parseBody, parseQueryString } from './body.js';
import { staticFile } from './static-file.js';
import { applySchema, InferSchemaOutput, RouteSchema, ValidatedHandlerFunction } from './validation.js';
import { parseCookies, serializeCookie } from './cookie.js';
import { bufferResponse } from './response-buffer.js';

export * from './types.js';
export { staticFile } from './static-file.js';
export { cors } from './cors.js';
export type { RouteSchema, ValidatedRouteContext, ValidatedHandlerFunction } from './validation.js';

/** Handler accepted by a route registered with a schema (see `RouteSchema`) */
type SchemaHandler<TParams, TQuery, TBody> = ValidatedHandlerFunction<
  InferSchemaOutput<TParams, Record<string, string>>,
  InferSchemaOutput<TQuery, Record<string, string>>,
  InferSchemaOutput<TBody, unknown>
>;

/** Result of a router lookup: the compiled handler to run and its extracted params */
interface RouteMatch {
  handler: RouteHandlerFunction;
  params: Record<string, string>;
  schema?: RouteSchema;
}

/**
 * BlitzJS - Main framework class handling routing, middleware, and HTTP
 * server management. Runtime code generation is enabled by default.
 *
 * Architecture:
 * - Static routes use O(1) HashMap lookup for instant access
 * - Dynamic routes use optimized regex with parameter extraction
 * - Every compiled handler shares one signature - `(ctx) => void|Promise<void>` -
 *   so the router never special-cases static vs. dynamic routes when invoking them
 */
export class BlitzJS {
  /** uWebSockets.js application instance (undefined for sub-apps) */
  private app: TemplatedApp | null;
  /** Dynamic routes (regex-matched); static routes live in `staticRoutes` */
  private routes: Route[] = [];
  /** Registered middlewares, run in order before the matched route handler */
  private middlewares: MiddlewareFunction[] = [];
  /** Application configuration */
  private config: BlitzConfig;
  /** Route prefix for sub-application mounting */
  private prefix: string;

  /** Whether runtime code generation is enabled */
  private codeGenEnabled: boolean = true;

  /** O(1) static route lookup using HashMap (method:pattern -> Route) */
  private staticRoutes = new Map<string, Route>();

  /**
   * Cache of compiled template handlers, scoped to this instance. Keeping it
   * per-instance (rather than shared across all BlitzJS apps) avoids leaking
   * a compiled handler from one app into another that happens to register
   * the same method+pattern (e.g. two servers in the same test process).
   */
  private templateCache = new Map<string, RouteHandlerFunction>();

  /**
   * Initialize a new BlitzJS application
   *
   * Creates either a main application (with a uWebSockets.js instance) or a
   * sub-application (for mounting with a prefix) based on configuration.
   */
  constructor(config: BlitzConfig = {}) {
    this.config = {
      port: 3000,
      host: '0.0.0.0',
      ...config
    };

    this.prefix = config.prefix || '';

    if (!config.prefix) {
      this.app = config.ssl ? SSLApp(config.ssl) : App();
      this.setupRoutes();
    } else {
      this.app = null; // Sub-app doesn't have its own uWS app
    }
  }

  /**
   * Add middleware to the application, or mount a sub-application.
   *
   * When mounting a sub-application, all its routes and middlewares are
   * integrated with the appropriate prefix handling.
   */
  use(middleware: MiddlewareFunction | BlitzJS): this {
    if (middleware instanceof BlitzJS) {
      this.mountSubApp(middleware);
    } else {
      this.middlewares.push(middleware);
    }
    return this;
  }

  private mountSubApp(subApp: BlitzJS): void {
    for (const middleware of subApp.middlewares) {
      this.middlewares.push(middleware);
    }

    for (const route of subApp.routes) {
      const prefixedPattern = this.combinePaths(subApp.prefix, route.pattern);
      this.addRoute(route.method, prefixedPattern, route.handler, route.originalHandler, route.schema);
    }

    for (const route of subApp.staticRoutes.values()) {
      const prefixedPattern = this.combinePaths(subApp.prefix, route.pattern);
      this.addRoute(route.method, prefixedPattern, route.handler, route.originalHandler, route.schema);
    }
  }

  /** Combine a prefix and a path, normalizing slashes between them */
  private combinePaths(prefix: string, path: string): string {
    if (!prefix) return path;

    const cleanPrefix = prefix.startsWith('/') ? prefix : '/' + prefix;
    const normalizedPrefix = cleanPrefix.endsWith('/') ? cleanPrefix.slice(0, -1) : cleanPrefix;
    const cleanPath = path.startsWith('/') ? path : '/' + path;

    return normalizedPrefix + cleanPath;
  }

  /**
   * Register a route handler, optionally validated with a `RouteSchema`.
   *
   * Without a schema: `ctx.params`/`query`/`body` stay as their raw
   * (`Record<string, string>` / `unknown`) shapes. With a schema: any
   * [Standard Schema](https://standardschema.dev)-compatible validator
   * (zod, valibot, arktype, ...) validates the matching input before the
   * handler runs, replacing it with the schema's typed output. On
   * validation failure the handler never runs and the request gets a `400`
   * with the collected issues.
   */
  private registerRoute(
    method: HttpMethod,
    pattern: string,
    schemaOrHandler: RouteSchema | SimpleHandler,
    maybeHandler?: (ctx: any) => unknown
  ): this {
    if (maybeHandler !== undefined) {
      const schema = schemaOrHandler as RouteSchema;
      const handler = maybeHandler as unknown as SimpleHandler;
      this.addRoute(method, pattern, createSimpleHandler(handler), handler, schema);
    } else {
      const handler = schemaOrHandler as SimpleHandler;
      this.addRoute(method, pattern, createSimpleHandler(handler), handler);
    }
    return this;
  }

  get<P extends StandardSchemaV1 | undefined = undefined, Q extends StandardSchemaV1 | undefined = undefined, B extends StandardSchemaV1 | undefined = undefined>(
    pattern: string, schema: RouteSchema<P, Q, B>, handler: SchemaHandler<P, Q, B>
  ): this;
  get(pattern: string, handler: SimpleHandler): this;
  get(pattern: string, schemaOrHandler: RouteSchema | SimpleHandler, maybeHandler?: (ctx: any) => unknown): this {
    return this.registerRoute('get', pattern, schemaOrHandler, maybeHandler);
  }

  post<P extends StandardSchemaV1 | undefined = undefined, Q extends StandardSchemaV1 | undefined = undefined, B extends StandardSchemaV1 | undefined = undefined>(
    pattern: string, schema: RouteSchema<P, Q, B>, handler: SchemaHandler<P, Q, B>
  ): this;
  post(pattern: string, handler: SimpleHandler): this;
  post(pattern: string, schemaOrHandler: RouteSchema | SimpleHandler, maybeHandler?: (ctx: any) => unknown): this {
    return this.registerRoute('post', pattern, schemaOrHandler, maybeHandler);
  }

  put<P extends StandardSchemaV1 | undefined = undefined, Q extends StandardSchemaV1 | undefined = undefined, B extends StandardSchemaV1 | undefined = undefined>(
    pattern: string, schema: RouteSchema<P, Q, B>, handler: SchemaHandler<P, Q, B>
  ): this;
  put(pattern: string, handler: SimpleHandler): this;
  put(pattern: string, schemaOrHandler: RouteSchema | SimpleHandler, maybeHandler?: (ctx: any) => unknown): this {
    return this.registerRoute('put', pattern, schemaOrHandler, maybeHandler);
  }

  delete<P extends StandardSchemaV1 | undefined = undefined, Q extends StandardSchemaV1 | undefined = undefined, B extends StandardSchemaV1 | undefined = undefined>(
    pattern: string, schema: RouteSchema<P, Q, B>, handler: SchemaHandler<P, Q, B>
  ): this;
  delete(pattern: string, handler: SimpleHandler): this;
  delete(pattern: string, schemaOrHandler: RouteSchema | SimpleHandler, maybeHandler?: (ctx: any) => unknown): this {
    return this.registerRoute('delete', pattern, schemaOrHandler, maybeHandler);
  }

  patch<P extends StandardSchemaV1 | undefined = undefined, Q extends StandardSchemaV1 | undefined = undefined, B extends StandardSchemaV1 | undefined = undefined>(
    pattern: string, schema: RouteSchema<P, Q, B>, handler: SchemaHandler<P, Q, B>
  ): this;
  patch(pattern: string, handler: SimpleHandler): this;
  patch(pattern: string, schemaOrHandler: RouteSchema | SimpleHandler, maybeHandler?: (ctx: any) => unknown): this {
    return this.registerRoute('patch', pattern, schemaOrHandler, maybeHandler);
  }

  options<P extends StandardSchemaV1 | undefined = undefined, Q extends StandardSchemaV1 | undefined = undefined, B extends StandardSchemaV1 | undefined = undefined>(
    pattern: string, schema: RouteSchema<P, Q, B>, handler: SchemaHandler<P, Q, B>
  ): this;
  options(pattern: string, handler: SimpleHandler): this;
  options(pattern: string, schemaOrHandler: RouteSchema | SimpleHandler, maybeHandler?: (ctx: any) => unknown): this {
    return this.registerRoute('options', pattern, schemaOrHandler, maybeHandler);
  }

  head<P extends StandardSchemaV1 | undefined = undefined, Q extends StandardSchemaV1 | undefined = undefined, B extends StandardSchemaV1 | undefined = undefined>(
    pattern: string, schema: RouteSchema<P, Q, B>, handler: SchemaHandler<P, Q, B>
  ): this;
  head(pattern: string, handler: SimpleHandler): this;
  head(pattern: string, schemaOrHandler: RouteSchema | SimpleHandler, maybeHandler?: (ctx: any) => unknown): this {
    return this.registerRoute('head', pattern, schemaOrHandler, maybeHandler);
  }

  /**
   * Start the HTTP server and begin listening for requests.
   *
   * Only works on a main app (not sub-apps with a prefix).
   */
  listen(port?: number, callback?: (token: false | object) => void): this {
    if (this.prefix) {
      throw new Error('Cannot call listen() on a sub-app with prefix. Use listen() on the main app.');
    }
    if (!this.app) {
      throw new Error('BlitzJS app was not initialized correctly.');
    }

    const serverPort = port || this.config.port!;

    this.app.listen(this.config.host!, serverPort, (token) => {
      if (token) {
        if (callback) callback(token);
      } else {
        console.error(`Failed to listen on port ${serverPort}`);
        process.exit(1);
      }
    });
    return this;
  }

  /** Get the underlying uWebSockets.js app instance (null for sub-apps) */
  getUwsApp(): TemplatedApp | null {
    return this.app;
  }

  /**
   * Static file helper for serving files. Kept as a static method for
   * backwards compatibility - equivalent to the standalone `staticFile()`.
   */
  static file(path: string): RouteHandlerFunction {
    return staticFile(path);
  }

  /**
   * Add a route: compiles its pattern, categorizes it as static or dynamic,
   * and pre-compiles its optimized handler.
   */
  private addRoute(method: HttpMethod, pattern: string, handler: RouteHandlerFunction, originalHandler?: SimpleHandler | RouteHandlerFunction, schema?: RouteSchema): void {
    const { regex, paramNames, isStatic } = compilePattern(pattern);

    const route: Route = {
      method,
      pattern,
      handler,
      regex,
      paramNames,
      isStatic,
      originalHandler: originalHandler !== undefined ? originalHandler : handler,
      compiledHandler: undefined,
      schema
    };

    if (this.codeGenEnabled && !this.prefix) {
      route.compiledHandler = compileOptimizedHandler(route, this.templateCache);
    }

    if (isStatic) {
      this.staticRoutes.set(`${method.toUpperCase()}:${pattern}`, route);
    } else {
      this.routes.push(route);
    }
  }

  /** Register catch-all handlers for each HTTP method, delegating to the ultra-fast request handler */
  private setupRoutes(): void {
    if (!this.app) return;

    this.app.get('/*', (res: HttpResponse, req: HttpRequest) => this.handleRequest(req, res));
    this.app.post('/*', (res: HttpResponse, req: HttpRequest) => this.handleRequest(req, res));
    this.app.put('/*', (res: HttpResponse, req: HttpRequest) => this.handleRequest(req, res));
    this.app.del('/*', (res: HttpResponse, req: HttpRequest) => this.handleRequest(req, res));
    this.app.patch('/*', (res: HttpResponse, req: HttpRequest) => this.handleRequest(req, res));
    this.app.options('/*', (res: HttpResponse, req: HttpRequest) => this.handleRequest(req, res));
    this.app.head('/*', (res: HttpResponse, req: HttpRequest) => this.handleRequest(req, res));
  }

  /**
   * Look up the compiled handler for a method+url, checking static routes
   * (O(1)) first, then dynamic routes (regex, in registration order).
   */
  private matchRoute(method: string, url: string): RouteMatch | null {
    const staticRoute = this.staticRoutes.get(`${method}:${url}`);
    if (staticRoute?.compiledHandler) {
      return { handler: staticRoute.compiledHandler, params: {}, schema: staticRoute.schema };
    }

    for (const route of this.routes) {
      if (route.method === method.toLowerCase()) {
        const match = route.regex.exec(url);
        if (match && route.compiledHandler) {
          const params: Record<string, string> = {};
          route.paramNames.forEach((name, index) => {
            params[name] = match[index + 1] || '';
          });
          return { handler: route.compiledHandler, params, schema: route.schema };
        }
      }
    }

    return null;
  }

  /**
   * Main request handler for all incoming HTTP requests.
   *
   * 1. Captures everything needed from `req` synchronously (uWebSockets.js
   *    invalidates the request object after the first `await`)
   * 2. Parses the body (POST/PUT/PATCH) and query string
   * 3. Matches the route and runs it through the middleware chain
   */
  private handleRequest = async (req: HttpRequest, res: HttpResponse): Promise<void> => {
    const method = req.getMethod().toUpperCase();
    const url = req.getUrl();
    const queryString = req.getQuery();
    const contentType = req.getHeader('content-type') || '';
    const cookieHeader = req.getHeader('cookie') || '';
    const bufferedRes = bufferResponse(res);

    try {
      const query = queryString ? parseQueryString(queryString) : {};
      const match = this.matchRoute(method, url);

      const ctx: RouteContext = {
        req,
        res: bufferedRes,
        params: match?.params ?? {},
        query,
        body: undefined,
        cookies: parseCookies(cookieHeader),
        setCookie: (name, value, options) => bufferedRes.writeHeader('Set-Cookie', serializeCookie(name, value, options))
      };

      /**
       * Terminal step of the middleware chain: 404 (no route), then body
       * parsing, then schema validation, then the matched handler.
       *
       * Middlewares run before routing so app-wide concerns (CORS
       * preflight, auth, logging) see every request - including ones with
       * no registered route, which a CORS preflight `OPTIONS` typically is.
       * Body parsing happens here, after middlewares, rather than upfront:
       * it's the only `await` in the pipeline that touches `req`, and
       * uWebSockets.js invalidates `req` after any await - parsing it
       * earlier would break any middleware reading `ctx.req` on a
       * POST/PUT/PATCH request.
       */
      const runFinal = async (): Promise<void> => {
        if (!match) {
          if (!res.aborted) {
            bufferedRes.writeStatus('404 Not Found');
            bufferedRes.end('Not Found');
          }
          return;
        }

        if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
          try {
            ctx.body = await parseBody(res, req, contentType);
          } catch (error) {
            console.error('Body parsing error:', error);
            return; // request was aborted mid-body; nothing left to respond to
          }
          if (res.aborted) return;
        }

        if (match.schema) {
          const issues = await applySchema(match.schema, ctx);
          if (issues.length > 0) {
            if (!res.aborted) {
              bufferedRes.writeStatus('400 Bad Request');
              bufferedRes.writeHeader('Content-Type', 'application/json');
              bufferedRes.end(JSON.stringify({ error: 'Validation Error', issues }));
            }
            return;
          }
        }

        await match.handler(ctx);
      };

      if (this.middlewares.length > 0) {
        await runMiddlewares(this.middlewares, ctx, runFinal);
      } else {
        await runFinal();
      }
    } catch (error) {
      console.error('Request handler error:', error);
      if (!res.aborted) {
        bufferedRes.writeStatus('500 Internal Server Error');
        bufferedRes.end('Internal Server Error');
      }
    }
  };
}

/**
 * Create a new BlitzJS instance (factory function)
 *
 * Supports both main applications and sub-applications with prefix mounting.
 */
export function Blitz(config?: BlitzConfig): BlitzJS {
  return new BlitzJS(config);
}
