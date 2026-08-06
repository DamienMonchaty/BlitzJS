import { HttpResponse } from 'uWebSockets.js';

/**
 * Wrap a uWS `HttpResponse` so `writeStatus`/`writeHeader` calls are buffered
 * instead of hitting the socket immediately, and flushed - status first,
 * then headers - on the first `end`/`write`/`tryEnd` call.
 *
 * uWebSockets.js requires `writeStatus` to be the very first call on a
 * response; any earlier `writeHeader` silently locks the status at "200 OK"
 * (see index.d.ts's docs on `writeStatus`). Middlewares (CORS, logging, ...)
 * commonly write headers before the final status is known (404/400/500 are
 * only decided downstream), so without this buffer their header writes
 * would permanently mask any non-200 status set later in the chain.
 */
export function bufferResponse(res: HttpResponse): HttpResponse {
  let pendingStatus = '200 OK';
  const pendingHeaders: [string, string][] = [];
  let flushed = false;

  function flush(): void {
    if (flushed) return;
    flushed = true;
    res.writeStatus(pendingStatus);
    for (const [key, value] of pendingHeaders) res.writeHeader(key, value);
  }

  return new Proxy(res, {
    get(target, prop, receiver) {
      switch (prop) {
        case 'writeStatus':
          return (status: string) => {
            pendingStatus = status;
            return receiver;
          };
        case 'writeHeader':
          return (key: string, value: string) => {
            pendingHeaders.push([key, value]);
            return receiver;
          };
        case 'end':
          return (body?: unknown) => {
            flush();
            return (target.end as (body?: unknown) => HttpResponse)(body);
          };
        case 'write':
          return (chunk: unknown) => {
            flush();
            return (target.write as (chunk: unknown) => boolean)(chunk);
          };
        case 'tryEnd':
          return (fullBodyOrChunk: unknown, totalSize: number) => {
            flush();
            return (target.tryEnd as (a: unknown, b: number) => [boolean, boolean])(fullBodyOrChunk, totalSize);
          };
      }

      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  }) as HttpResponse;
}
