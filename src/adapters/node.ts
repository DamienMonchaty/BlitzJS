import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { FetchHandler, ServeOptions } from './types.js';

export interface NodeServeOptions extends ServeOptions {
  onListen?: (address: string) => void;
}

export interface NodeLikeServer {
  close(): void;
}

function isBodylessMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

function createRequestUrl(req: IncomingMessage, hostFallback: string): string {
  const host = req.headers.host ?? hostFallback;
  const path = req.url ?? '/';
  return `http://${host}${path}`;
}

function toRequest(req: IncomingMessage, hostFallback: string): Request {
  const method = req.method ?? 'GET';
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
      continue;
    }

    if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const controller = new AbortController();
  req.on('aborted', () => controller.abort());
  req.on('close', () => {
    if (!req.complete) {
      controller.abort();
    }
  });

  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    signal: controller.signal
  };

  if (!isBodylessMethod(method)) {
    init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }

  return new Request(createRequestUrl(req, hostFallback), init);
}

function parseStatusText(response: Response): string | undefined {
  const statusText = response.statusText?.trim();
  return statusText.length > 0 ? statusText : undefined;
}

function applyHeaders(response: Response, res: ServerResponse): void {
  const headers = response.headers;

  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') {
    const setCookies = getSetCookie.call(headers);
    if (setCookies.length > 0) {
      res.setHeader('set-cookie', setCookies);
    }
  }

  for (const [name, value] of headers.entries()) {
    if (name.toLowerCase() === 'set-cookie') {
      continue;
    }

    const existing = res.getHeader(name);
    if (existing === undefined) {
      res.setHeader(name, value);
      continue;
    }

    if (Array.isArray(existing)) {
      res.setHeader(name, [...existing, value]);
    } else {
      res.setHeader(name, [String(existing), value]);
    }
  }
}

async function writeResponseBody(response: Response, res: ServerResponse): Promise<void> {
  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (value && value.length > 0) {
        const canContinue = res.write(Buffer.from(value));
        if (!canContinue) {
          await once(res, 'drain');
        }
      }
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

async function handleNodeRequest(handler: FetchHandler, req: IncomingMessage, res: ServerResponse, hostFallback: string): Promise<void> {
  try {
    const request = toRequest(req, hostFallback);
    const response = await handler(request);

    res.statusCode = response.status;
    const statusText = parseStatusText(response);
    if (statusText) {
      res.statusMessage = statusText;
    }

    applyHeaders(response, res);
    await writeResponseBody(response, res);
  } catch (error) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
    }

    const payload = JSON.stringify({
      error: 'Internal Server Error',
      details: String(error)
    });
    res.end(payload);
  }
}

export function serveWithNode(handler: FetchHandler, options: NodeServeOptions = {}): NodeLikeServer {
  const port = options.port ?? 3000;
  const host = options.host ?? '0.0.0.0';

  const server = createServer((req, res) => {
    void handleNodeRequest(handler, req, res, `${host}:${port}`);
  });

  server.listen(port, host, () => {
    const address = server.address() as AddressInfo | null;
    const listenHost = address?.address ?? host;
    const listenPort = address?.port ?? port;
    options.onListen?.(`http://${listenHost}:${listenPort}`);
  });

  return {
    close(): void {
      server.close();
    }
  };
}
