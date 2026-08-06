import { Route, RouteContext, RouteHandlerFunction } from './types.js';

/**
 * TEMPLATE PATTERN WITH CODE GENERATION
 *
 * Each `create*Template` below generates the handler's source as a string
 * and compiles it once (at route registration) via `new Function`, instead
 * of writing a generic closure that loops over `precomputedHeaders` on every
 * request. The header list is known at compile time, so the loop is
 * unrolled into straight-line `writeHeader` calls baked into the function
 * body - no per-request array indexing/branching for something that never
 * changes between requests.
 *
 * Every template still shares the same call signature,
 * `(ctx: RouteContext) => void | Promise<void>`, so the router never needs
 * to know whether a route is static or dynamic when invoking its compiled
 * handler - `ctx.params` already carries whatever was extracted (or `{}`
 * for static routes).
 *
 * Header values come only from `precomputeOptimizedHeaders` below (fixed,
 * framework-controlled strings) - never from user/request input - so
 * `JSON.stringify`-embedding them into generated source carries no
 * injection risk.
 */

/** Turn a flat `[key, value, key, value, ...]` array into literal `writeHeader` statements */
function unrollHeaderStatements(headers: string[]): string {
  const statements: string[] = [];
  for (let i = 0; i < headers.length; i += 2) {
    statements.push(`ctx.res.writeHeader(${JSON.stringify(headers[i])}, ${JSON.stringify(headers[i + 1])});`);
  }
  return statements.join('\n          ');
}

/** Template for handlers with a pre-computed string response */
function createStringTemplate(precomputedBuffer: Buffer, precomputedHeaders: string[]): RouteHandlerFunction {
  const source = `
    return function templateStringHandler(ctx) {
      try {
        if (!ctx.res.aborted) {
          ${unrollHeaderStatements(precomputedHeaders)}
          ctx.res.end(buffer);
        }
      } catch (error) {
        console.error('String template error:', error);
        if (!ctx.res.aborted) {
          ctx.res.writeStatus('500 Internal Server Error');
          ctx.res.end('Internal Server Error');
        }
      }
    };
  `;

  const factory = new Function('buffer', 'console', source) as (buffer: Buffer, console: Console) => RouteHandlerFunction;
  return factory(precomputedBuffer, console);
}

/** Template for handlers with a pre-serialized JSON response */
function createJSONTemplate(precomputedBuffer: Buffer, precomputedHeaders: string[]): RouteHandlerFunction {
  const source = `
    return function templateJSONHandler(ctx) {
      try {
        if (!ctx.res.aborted) {
          ${unrollHeaderStatements(precomputedHeaders)}
          ctx.res.end(buffer);
        }
      } catch (error) {
        console.error('JSON template error:', error);
        if (!ctx.res.aborted) {
          ctx.res.writeStatus('500 Internal Server Error');
          ctx.res.end('{"error":"Internal Server Error"}');
        }
      }
    };
  `;

  const factory = new Function('buffer', 'console', source) as (buffer: Buffer, console: Console) => RouteHandlerFunction;
  return factory(precomputedBuffer, console);
}

/**
 * Template for user-provided function handlers, with auto-serialized return
 * values. Deliberately doesn't catch errors from `handler` itself - letting
 * them propagate up through the middleware chain is what makes
 * `errorHandler()` (and any other error-aware middleware) able to see them;
 * catching here would silently swallow them into a generic 500 first.
 */
function createFunctionTemplate(originalHandler: (ctx: RouteContext) => unknown, precomputedHeaders: string[]): RouteHandlerFunction {
  const source = `
    return async function templateFunctionHandler(ctx) {
      ${unrollHeaderStatements(precomputedHeaders)}

      const result = await handler(ctx);

      if (result !== undefined && !ctx.res.aborted) {
        if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean' || result === null) {
          ctx.res.writeHeader('Content-Type', 'text/plain; charset=utf-8');
          ctx.res.end(String(result));
        } else {
          ctx.res.writeHeader('Content-Type', 'application/json; charset=utf-8');
          ctx.res.end(JSON.stringify(result));
        }
      }
    };
  `;

  const factory = new Function('handler', source) as (
    handler: (ctx: RouteContext) => unknown
  ) => RouteHandlerFunction;
  return factory(originalHandler);
}

/**
 * Pre-compute optimized headers for a route's template.
 *
 * Headers are stored as a flat array for ultra-fast iteration without
 * object property access overhead.
 *
 * Function handlers get no precomputed Content-Type: their return value
 * (and thus its type) is only known at request time, so
 * `createFunctionTemplate` sets it itself - precomputing one here would
 * duplicate whichever one the runtime path writes.
 */
function precomputeOptimizedHeaders(route: Route): string[] {
  const headers: string[] = [];

  if (typeof route.originalHandler === 'string') {
    headers.push('Content-Type', 'text/plain; charset=utf-8');
  } else if (typeof route.originalHandler !== 'function') {
    headers.push('Content-Type', 'application/json; charset=utf-8');
  }

  headers.push('X-Powered-By', 'BlitzJS-Template-Optimized');

  return headers;
}

/**
 * OPTIMIZED HANDLER COMPILATION with Template Pattern
 *
 * Generates a specialized handler based on the route's response type:
 * - String responses: Pre-computed buffer with zero-allocation sending
 * - JSON responses: Pre-serialized JSON buffer
 * - Function responses: Optimized template with auto-serialization
 *
 * `cache` is expected to be scoped to a single BlitzJS instance - sharing it
 * across independent apps would leak compiled handlers between them.
 */
export function compileOptimizedHandler(route: Route, cache: Map<string, RouteHandlerFunction>): RouteHandlerFunction {
  const routeKey = `${route.method}_${route.pattern}`;

  const cached = cache.get(routeKey);
  if (cached) return cached;

  let compiledHandler: RouteHandlerFunction;
  const templateHeaders = precomputeOptimizedHeaders(route);

  if (typeof route.originalHandler === 'string') {
    const responseBuffer = Buffer.from(route.originalHandler, 'utf8');
    compiledHandler = createStringTemplate(responseBuffer, templateHeaders);
  } else if (typeof route.originalHandler === 'object' && route.originalHandler !== null) {
    const jsonBuffer = Buffer.from(JSON.stringify(route.originalHandler), 'utf8');
    compiledHandler = createJSONTemplate(jsonBuffer, templateHeaders);
  } else if (typeof route.originalHandler === 'function') {
    compiledHandler = createFunctionTemplate(route.originalHandler as (ctx: RouteContext) => unknown, templateHeaders);
  } else {
    // Fallback for unknown handler types
    compiledHandler = route.handler;
  }

  cache.set(routeKey, compiledHandler);
  return compiledHandler;
}
