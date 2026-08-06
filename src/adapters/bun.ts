import { createFetchHandler, type FetchDispatchApp } from './fetch.js';

export interface BunServeOptions {
  port?: number;
  host?: string;
  onListen?: (address: string) => void;
}

declare const Bun: {
  serve(options: {
    port?: number;
    hostname?: string;
    fetch: (request: Request) => Response | Promise<Response>;
  }): unknown;
};

export function serveWithBun(app: FetchDispatchApp, options: BunServeOptions = {}): void {
  const port = options.port ?? 3000;
  const host = options.host ?? '0.0.0.0';

  Bun.serve({
    port,
    hostname: host,
    fetch: createFetchHandler(app)
  });

  options.onListen?.(`http://${host}:${port}`);
}
