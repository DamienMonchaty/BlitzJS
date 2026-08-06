export interface RuntimeRequest {
  method(): string;
  path(): string;
  queryString(): string;
  header(name: string): string;
  parseBody(contentType: string): Promise<unknown>;
  raw(): unknown;

  // Legacy aliases kept for compatibility during the adapter migration.
  getMethod(): string;
  getUrl(): string;
  getQuery(): string;
  getHeader(name: string): string;
}

export interface RuntimeResponse {
  readonly aborted: boolean;
  status(status: string): this;
  header(name: string, value: string): this;
  send(body?: unknown): this;
  raw(): unknown;
  write(chunk: unknown): boolean;
  tryEnd(fullBodyOrChunk: unknown, totalSize: number): [boolean, boolean];

  // Legacy aliases kept for compatibility during the adapter migration.
  writeStatus(status: string): this;
  writeHeader(name: string, value: string): this;
  end(body?: unknown): this;
  remoteAddressText(): string | undefined;
}
