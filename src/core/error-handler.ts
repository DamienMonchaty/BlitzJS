import { MiddlewareFunction, RouteContext } from './types.js';

export interface ErrorHandlerOptions {
  /** Called when a downstream middleware or route handler throws. Must write its own response. */
  onError?: (error: unknown, ctx: RouteContext) => void | Promise<void>;
}

/**
 * Error handling middleware. Catches anything thrown by downstream
 * middlewares or the matched route handler and turns it into a response
 * instead of a generic 500, via `onError`.
 *
 * Register it first with `.use()` - middlewares run outermost-first, so it
 * must wrap every other middleware and the handler to catch their errors.
 */
export function errorHandler(options: ErrorHandlerOptions = {}): MiddlewareFunction {
  return async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      if (options.onError) {
        await options.onError(error, ctx);
        return;
      }

      console.error('Unhandled error:', error);
      if (!ctx.res.aborted) {
        ctx.res.writeStatus('500 Internal Server Error');
        ctx.res.end('Internal Server Error');
      }
    }
  };
}
