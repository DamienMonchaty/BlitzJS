import { HttpRequest, HttpResponse, getParts } from 'uWebSockets.js';
import { parseBodyBuffer, type MultipartBody } from '../core/body.js';
import { RuntimeRequest, RuntimeResponse } from '../core/runtime.js';

function parseMultipart(rawBody: Buffer, contentType: string): MultipartBody {
  const parts = getParts(rawBody, contentType) ?? [];
  const result: MultipartBody = {};

  for (const part of parts) {
    result[part.name] = part.filename !== undefined
      ? { filename: part.filename, type: part.type, data: Buffer.from(part.data) }
      : Buffer.from(part.data).toString();
  }

  return result;
}

/**
 * Parse request body for POST/PUT/PATCH requests.
 *
 * Must be called synchronously (before any `await`) relative to the request
 * handler entry, since it registers `onData`/`onAborted` directly on `res` -
 * uWebSockets.js requires these to be set up before the request object can
 * become invalid.
 */
function parseBody(res: HttpResponse, contentType: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    res.onData((chunk: ArrayBuffer, isLast: boolean) => {
      chunks.push(Buffer.from(chunk));

      if (isLast) {
        const rawBody = Buffer.concat(chunks);
        resolve(contentType.includes('multipart/form-data') ? parseMultipart(rawBody, contentType) : parseBodyBuffer(rawBody, contentType));
      }
    });

    res.onAborted(() => {
      (res as HttpResponse & { aborted?: boolean }).aborted = true;
      reject(new Error('Request aborted'));
    });
  });
}

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
function bufferResponse(res: HttpResponse): HttpResponse {
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

export class UwsRequestAdapter implements RuntimeRequest {
  constructor(private readonly req: HttpRequest, private readonly res: HttpResponse) {}

  method(): string {
    return this.req.getMethod();
  }

  path(): string {
    return this.req.getUrl();
  }

  queryString(): string {
    return this.req.getQuery();
  }

  header(name: string): string {
    return this.req.getHeader(name) || '';
  }

  parseBody(contentType: string): Promise<unknown> {
    return parseBody(this.res, contentType);
  }

  raw(): HttpRequest {
    return this.req;
  }

  getMethod(): string {
    return this.method();
  }

  getUrl(): string {
    return this.path();
  }

  getQuery(): string {
    return this.queryString();
  }

  getHeader(name: string): string {
    return this.header(name);
  }
}

export class UwsResponseAdapter implements RuntimeResponse {
  private readonly buffered: HttpResponse;

  constructor(private readonly res: HttpResponse) {
    this.buffered = bufferResponse(res);
  }

  get aborted(): boolean {
    return Boolean((this.res as HttpResponse & { aborted?: boolean }).aborted);
  }

  status(status: string): this {
    this.buffered.writeStatus(status);
    return this;
  }

  header(name: string, value: string): this {
    this.buffered.writeHeader(name, value);
    return this;
  }

  send(body?: unknown): this {
    this.buffered.end(body as Parameters<HttpResponse['end']>[0]);
    return this;
  }

  raw(): HttpResponse {
    return this.res;
  }

  write(chunk: unknown): boolean {
    return this.buffered.write(chunk as Parameters<HttpResponse['write']>[0]);
  }

  tryEnd(fullBodyOrChunk: unknown, totalSize: number): [boolean, boolean] {
    return this.buffered.tryEnd(fullBodyOrChunk as Parameters<HttpResponse['tryEnd']>[0], totalSize);
  }

  writeStatus(status: string): this {
    return this.status(status);
  }

  writeHeader(name: string, value: string): this {
    return this.header(name, value);
  }

  end(body?: unknown): this {
    return this.send(body);
  }

  remoteAddressText(): string | undefined {
    if (typeof this.res.getRemoteAddressAsText !== 'function') return undefined;
    return Buffer.from(this.res.getRemoteAddressAsText()).toString();
  }
}
