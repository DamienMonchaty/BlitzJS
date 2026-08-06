import { RouteHandlerFunction } from './types.js';
import { defaultRuntimeServices, type RuntimeServices } from './platform.js';

const MIME_TYPES: Record<string, string> = {
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown'
};

/** Get the MIME type for a file path, based on its extension */
function getMimeType(filepath: string): string {
  const ext = filepath.split('.').pop()?.toLowerCase();
  return MIME_TYPES[ext || ''] || 'application/octet-stream';
}

/**
 * Static file helper for serving files
 *
 * Provides efficient static file serving with automatic MIME type detection
 * and proper HTTP headers. Handles missing files with a 404.
 */
export function staticFile(path: string, services: RuntimeServices = defaultRuntimeServices): RouteHandlerFunction {
  return async (ctx) => {
    try {
      if (!(await services.fileExists(path))) {
        ctx.res.writeStatus('404 Not Found');
        ctx.res.end('File not found');
        return;
      }

      const file = await services.readFile(path);

      ctx.res.writeHeader('Content-Type', getMimeType(path));
      ctx.res.writeHeader('Content-Length', file.size.toString());
      ctx.res.end(file.content);
    } catch (error) {
      console.error('Static file error:', error);
      if (!ctx.res.aborted) {
        ctx.res.writeStatus('500 Internal Server Error');
        ctx.res.end('Error reading file');
      }
    }
  };
}
