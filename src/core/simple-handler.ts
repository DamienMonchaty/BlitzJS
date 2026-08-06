import { RouteContext, RouteHandlerFunction, SimpleHandler, SimpleHandlerFunction } from './types.js';

/**
 * Write a value returned by a simple handler to the response, auto-serializing
 * based on its type:
 * - Primitives (string, number, boolean, null) -> text/plain
 * - Objects/Arrays -> application/json
 * - undefined -> nothing (handler already wrote the response itself)
 */
function sendResult(ctx: RouteContext, result: unknown): void {
  if (result === undefined || ctx.res.aborted) return;

  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean' || result === null) {
    ctx.res.writeHeader('Content-Type', 'text/plain');
    ctx.res.end(String(result));
  } else if (typeof result === 'object') {
    ctx.res.writeHeader('Content-Type', 'application/json');
    ctx.res.end(JSON.stringify(result));
  }
}

/**
 * Create a route handler that supports simple responses with auto-serialization
 *
 * Converts a SimpleHandler (a raw value, or a function returning a value) into
 * a full RouteHandlerFunction. Handlers that manage the response themselves
 * (calling `ctx.res.end()` and returning `undefined`) work transparently since
 * `sendResult` is a no-op for `undefined` results.
 */
export function createSimpleHandler(handler: SimpleHandler): RouteHandlerFunction {
  if (typeof handler === 'function') {
    return async (ctx: RouteContext) => {
      try {
        const result = await (handler as SimpleHandlerFunction)(ctx);
        sendResult(ctx, result);
      } catch (error) {
        console.error('Handler error:', error);
        if (!ctx.res.aborted) {
          ctx.res.writeStatus('500 Internal Server Error');
          ctx.res.writeHeader('Content-Type', 'application/json');
          ctx.res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      }
    };
  }

  if (typeof handler === 'object' && handler !== null) {
    // Simple object/array response (JSON) - pre-serialize for performance
    const jsonString = JSON.stringify(handler);
    return async (ctx: RouteContext) => {
      ctx.res.writeHeader('Content-Type', 'application/json');
      ctx.res.end(jsonString);
    };
  }

  // Simple primitive response (string, number, boolean, null) - pre-compile for performance
  const stringified = String(handler);
  return async (ctx: RouteContext) => {
    ctx.res.writeHeader('Content-Type', 'text/plain');
    ctx.res.end(stringified);
  };
}
