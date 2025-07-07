// BlitzJS - Ultra-lightweight, Elysia-like web framework
export { 
  BlitzJS, 
  type BlitzConfig,
  type RouteContext,
  type RouteHandlerFunction,
  type MiddlewareFunction,
  type HttpMethod,
  type SimpleResponse,
  type SimpleHandlerFunction,
  type SimpleHandler
} from './core/BlitzJS';

// Re-export uWebSockets types for advanced users
export type { HttpRequest, HttpResponse, TemplatedApp } from 'uWebSockets.js';
