import { HttpRequest, HttpResponse, getParts } from 'uWebSockets.js';

/** A multipart field with a filename (uploaded file); text fields resolve to a plain string instead */
export interface MultipartFile {
  filename: string;
  type?: string;
  data: Buffer;
}

/** Parsed multipart/form-data body: text fields are strings, file fields are `MultipartFile` */
export type MultipartBody = Record<string, string | MultipartFile>;

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

export function parseBodyBuffer(rawBody: Buffer, contentType: string): unknown {
  try {
    if (contentType.includes('multipart/form-data')) {
      return parseMultipart(rawBody, contentType);
    }
    if (contentType.includes('application/json')) {
      return rawBody.length ? JSON.parse(rawBody.toString()) : undefined;
    }
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(rawBody.toString());
      const result: Record<string, string> = {};
      for (const [key, value] of params) {
        result[key] = value;
      }
      return result;
    }
    return rawBody.toString();
  } catch {
    return rawBody.toString();
  }
}

/**
 * Parse request body for POST/PUT/PATCH requests.
 *
 * Must be called synchronously (before any `await`) relative to the request
 * handler entry, since it registers `onData`/`onAborted` directly on `res` -
 * uWebSockets.js requires these to be set up before the request object can
 * become invalid.
 */
export async function parseBody(res: HttpResponse, _req: HttpRequest, contentType: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    res.onData((chunk: ArrayBuffer, isLast: boolean) => {
      chunks.push(Buffer.from(chunk));

      if (isLast) {
        const rawBody = Buffer.concat(chunks);
        resolve(parseBodyBuffer(rawBody, contentType));
      }
    });

    res.onAborted(() => {
      (res as HttpResponse & { aborted?: boolean }).aborted = true;
      reject(new Error('Request aborted'));
    });
  });
}

/** Parse a query string (without leading '?') into a flat key/value map */
export function parseQueryString(queryString: string): Record<string, string> {
  const params = new URLSearchParams(queryString);
  const result: Record<string, string> = {};

  for (const [key, value] of params) {
    result[key] = value;
  }

  return result;
}
