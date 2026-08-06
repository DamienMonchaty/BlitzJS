import { Route, RouteContext, RouteHandlerFunction } from './types.js';

function createStringTemplate(precomputedBuffer: Buffer, precomputedHeaders: string[]): RouteHandlerFunction {
  return function templateStringHandler(ctx: RouteContext) {
    try {
      if (!ctx.res.aborted) {
        for (let i = 0; i < precomputedHeaders.length; i += 2) {
          ctx.res.writeHeader(precomputedHeaders[i], precomputedHeaders[i + 1]);
        }
        ctx.res.end(precomputedBuffer);
      }
    } catch (error) {
      console.error('String template error:', error);
      if (!ctx.res.aborted) {
        ctx.res.writeStatus('500 Internal Server Error');
        ctx.res.end('Internal Server Error');
      }
    }
  };
}

function createJSONTemplate(precomputedBuffer: Buffer, precomputedHeaders: string[]): RouteHandlerFunction {
  return function templateJSONHandler(ctx: RouteContext) {
    try {
      if (!ctx.res.aborted) {
        for (let i = 0; i < precomputedHeaders.length; i += 2) {
          ctx.res.writeHeader(precomputedHeaders[i], precomputedHeaders[i + 1]);
        }
        ctx.res.end(precomputedBuffer);
      }
    } catch (error) {
      console.error('JSON template error:', error);
      if (!ctx.res.aborted) {
        ctx.res.writeStatus('500 Internal Server Error');
        ctx.res.end('{"error":"Internal Server Error"}');
      }
    }
  };
}

function createFunctionTemplate(originalHandler: (ctx: RouteContext) => unknown, precomputedHeaders: string[]): RouteHandlerFunction {
  return async function templateFunctionHandler(ctx: RouteContext) {
    try {
      for (let i = 0; i < precomputedHeaders.length; i += 2) {
        ctx.res.writeHeader(precomputedHeaders[i], precomputedHeaders[i + 1]);
      }

      const result = await originalHandler(ctx);

      if (result !== undefined && !ctx.res.aborted) {
        if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean' || result === null) {
          ctx.res.writeHeader('Content-Type', 'text/plain; charset=utf-8');
          ctx.res.end(String(result));
        } else {
          ctx.res.end(JSON.stringify(result));
        }
      }
    } catch (error) {
      console.error('Function template error:', error);
      if (!ctx.res.aborted) {
        ctx.res.writeStatus('500 Internal Server Error');
        ctx.res.end('Internal Server Error');
      }
    }
  };
}

function precomputeOptimizedHeaders(route: Route): string[] {
  const headers: string[] = [];

  if (typeof route.originalHandler === 'string') {
    headers.push('Content-Type', 'text/plain; charset=utf-8');
  } else {
    headers.push('Content-Type', 'application/json; charset=utf-8');
  }

  headers.push('X-Powered-By', 'BlitzJS-Template-Optimized');

  return headers;
}

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
    compiledHandler = route.handler;
  }

  cache.set(routeKey, compiledHandler);
  return compiledHandler;
}
