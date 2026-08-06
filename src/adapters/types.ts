export type FetchHandler = (request: Request) => Response | Promise<Response>;

export interface ServeOptions {
  port?: number;
  host?: string;
}
