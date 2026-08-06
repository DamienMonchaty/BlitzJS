import { MiddlewareFunction, RouteContext } from './types.js';

/**
 * Run a chain of middlewares followed by a final handler, using the classic
 * `next()` continuation pattern. Each middleware must call `next()` to pass
 * control to the next one; omitting the call short-circuits the chain
 * (useful for auth middlewares that end the response early).
 */
export async function runMiddlewares(
  middlewares: MiddlewareFunction[],
  ctx: RouteContext,
  final: () => Promise<void>
): Promise<void> {
  let index = -1;

  async function dispatch(i: number): Promise<void> {
    if (i <= index) {
      throw new Error('next() called multiple times in middleware chain');
    }
    index = i;

    if (i === middlewares.length) {
      await final();
      return;
    }

    await middlewares[i](ctx, () => dispatch(i + 1));
  }

  await dispatch(0);
}
