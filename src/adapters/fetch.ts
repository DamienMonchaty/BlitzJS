import { parseBodyBuffer, type MultipartBody } from '../core/body.js';
import { RuntimeRequest, RuntimeResponse } from '../core/runtime.js';

export interface FetchDispatchApp {
  dispatchRuntimeRequest(req: RuntimeRequest, res: RuntimeResponse): Promise<void>;
}

function parseStatus(status: string): { code: number; text: string } {
  const firstSpace = status.indexOf(' ');
  if (firstSpace === -1) {
    const code = Number(status);
    return { code: Number.isFinite(code) ? code : 200, text: '' };
  }

  const code = Number(status.slice(0, firstSpace));
  return {
    code: Number.isFinite(code) ? code : 200,
    text: status.slice(firstSpace + 1)
  };
}

async function formDataToMultipartBody(formData: FormData): Promise<MultipartBody> {
  const result: MultipartBody = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      result[key] = value;
      continue;
    }

    result[key] = {
      filename: value.name,
      type: value.type,
      data: Buffer.from(await value.arrayBuffer())
    };
  }

  return result;
}

export class FetchRequestAdapter implements RuntimeRequest {
  private readonly url: URL;

  constructor(private readonly request: Request) {
    this.url = new URL(request.url);
  }

  method(): string {
    return this.request.method;
  }

  path(): string {
    return this.url.pathname;
  }

  queryString(): string {
    return this.url.search.startsWith('?') ? this.url.search.slice(1) : this.url.search;
  }

  header(name: string): string {
    return this.request.headers.get(name) ?? '';
  }

  async parseBody(contentType: string): Promise<unknown> {
    if (contentType.includes('multipart/form-data')) {
      return formDataToMultipartBody(await this.request.formData());
    }

    const buffer = Buffer.from(await this.request.arrayBuffer());
    return parseBodyBuffer(buffer, contentType);
  }

  raw(): Request {
    return this.request;
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

export class FetchResponseAdapter implements RuntimeResponse {
  private statusValue = '200 OK';
  private readonly headers = new Headers();
  private chunks: Uint8Array[] = [];
  private finished = false;

  get aborted(): boolean {
    return false;
  }

  status(status: string): this {
    this.statusValue = status;
    return this;
  }

  header(name: string, value: string): this {
    this.headers.append(name, value);
    return this;
  }

  send(body?: unknown): this {
    this.finished = true;

    if (body === undefined) {
      this.chunks = [];
      return this;
    }

    if (body instanceof Uint8Array) {
      this.chunks = [body];
      return this;
    }

    this.chunks = [Buffer.from(String(body))];
    return this;
  }

  raw(): Response | undefined {
    return undefined;
  }

  write(chunk: unknown): boolean {
    const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk));
    this.chunks.push(bytes);
    return true;
  }

  tryEnd(fullBodyOrChunk: unknown, _totalSize: number): [boolean, boolean] {
    this.write(fullBodyOrChunk);
    this.finished = true;
    return [true, true];
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
    return undefined;
  }

  toResponse(): Response {
    const { code, text } = parseStatus(this.statusValue);
    const body = this.chunks.length === 0 ? null : Buffer.concat(this.chunks.map((chunk) => Buffer.from(chunk)));
    return new Response(body, {
      status: code,
      statusText: text,
      headers: this.headers
    });
  }
}

export function createFetchHandler(app: FetchDispatchApp): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const adaptedReq = new FetchRequestAdapter(request);
    const adaptedRes = new FetchResponseAdapter();
    await app.dispatchRuntimeRequest(adaptedReq, adaptedRes);
    return adaptedRes.toResponse();
  };
}