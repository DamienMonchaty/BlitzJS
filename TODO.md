# TODO

État vérifié dans le code (`src/core/`), pas une simple recopie du README.

## Fait

- [x] Request body parsing — JSON, urlencoded, multipart/form-data (`body.ts`)
- [x] Query string parsing (`body.ts`)
- [x] Cookie support (`cookie.ts`)
- [x] Static file serving (`static-file.ts`)
- [x] CORS support (`cors.ts`)
- [x] Request validation — Standard Schema (zod/valibot/arktype) (`validation.ts`)
- [x] Error handling middleware — `errorHandler()` composable, `onError` custom (`error-handler.ts`)
- [x] Session management — `session()` middleware, `ctx.session`, `SessionStore` pluggable (défaut in-memory) (`session.ts`)
- [x] Rate limiting — `rateLimit()` plugin opt-in via `.use()`, fixed-window in-memory (`rate-limit.ts`)
- [x] WebSocket support — `.ws(pattern, behavior)`, proxy direct vers `uWebSockets.js` (`BlitzJS.ts`)
- [x] OpenAPI/Swagger support — `generateOpenApiDocument()` (spec OpenAPI 3.2, `openapi.ts`) + plugin `.use(swagger())` façon Elysia (`swagger.ts`) : sert `/docs` (swagger-ui self-hosted via `swagger-ui-dist`) et `/openapi.json`, options `exclude`/`documentation`. Voir `examples/openapi-demo.ts`

- [x] Plugin system — `.use(plugin())` où `plugin: (app) => void` (type `PluginFunction`), distingué du middleware par arité. Base de `swagger()`. Voir `examples/plugin-demo.ts`

## Pas commencé
- [x] Authentication helpers - `requireSessionAuth()`, `requireBearerAuth()`, `requireBasicAuth()`, parsing helpers (`auth.ts`)
- [x] Database integrations - `database()`, `getDatabase()`, `requireDatabase()` agnostiques (Prisma/Drizzle/Mongoose/etc.) (`database.ts`)
- [ ] Testing utilities
- [ ] Performance monitoring
- [ ] Clustering support
