/** A multipart field with a filename (uploaded file); text fields resolve to a plain string instead */
export interface MultipartFile {
  filename: string;
  type?: string;
  data: Buffer;
}

/** Parsed multipart/form-data body: text fields are strings, file fields are `MultipartFile` */
export type MultipartBody = Record<string, string | MultipartFile>;

/**
 * Parse a buffered body into JSON/urlencoded/text (runtime-agnostic).
 *
 * Multipart isn't handled here: the fetch-based adapters (node/bun/fetch)
 * intercept `multipart/form-data` earlier via the standard `Request.formData()`
 * API, before a raw buffer is ever produced. Only the uWS adapter needs a
 * manual multipart parser (see `adapters/uws.ts`'s `parseMultipart`, backed
 * by uWebSockets.js's own `getParts`).
 */
export function parseBodyBuffer(rawBody: Buffer, contentType: string): unknown {
  try {
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

/** Parse a query string (without leading '?') into a flat key/value map */
export function parseQueryString(queryString: string): Record<string, string> {
  const params = new URLSearchParams(queryString);
  const result: Record<string, string> = {};

  for (const [key, value] of params) {
    result[key] = value;
  }

  return result;
}
