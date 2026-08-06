import { HttpRequest, HttpResponse } from 'uWebSockets.js';
import { parseBody } from '../core/body.js';
import { bufferResponse } from '../core/response-buffer.js';
import { RuntimeRequest, RuntimeResponse } from '../core/runtime.js';

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
    return parseBody(this.res, this.req, contentType);
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
