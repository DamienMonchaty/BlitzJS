import { HttpRequest, HttpResponse } from 'uWebSockets.js';

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
    const buffer: Buffer[] = [];

    res.onData((chunk: ArrayBuffer, isLast: boolean) => {
      buffer.push(Buffer.from(chunk));

      if (isLast) {
        const bodyString = Buffer.concat(buffer).toString();

        try {
          if (contentType.includes('application/json')) {
            resolve(bodyString.length ? JSON.parse(bodyString) : undefined);
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            const params = new URLSearchParams(bodyString);
            const result: Record<string, string> = {};
            for (const [key, value] of params) {
              result[key] = value;
            }
            resolve(result);
          } else {
            resolve(bodyString);
          }
        } catch {
          resolve(bodyString); // Return raw string if parsing fails
        }
      }
    });

    res.onAborted(() => {
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
