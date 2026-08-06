# Using BlitzJS

BlitzJS is a minimal HTTP framework on top of [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js). This guide covers the public API as implemented today.

## Install & build

```bash
npm install
npm run build   # compiles src/ -> dist/ (tsc)
```

`uWebSockets.js` ships prebuilt native binaries for specific Node versions (see its README for the supported list) - if `npm run build`/your app crashes on import with a "Cannot find module './uws_*.node'" error, your Node version isn't one of them.

## Quick start

```typescript
import { BlitzJS } from '@damienmonchaty/blitzjs';

new BlitzJS()
  .get('/', 'Hello BlitzJS!')
  .get('/json', { message: 'Auto JSON response!' })
  .get('/user/:id', (ctx) => ({ id: ctx.params.id, name: `User ${ctx.params.id}` }))
  .listen(3000, () => console.log('listening on :3000'));
```

Or with the factory function:

```typescript
import { Blitz } from '@damienmonchaty/blitzjs';

Blitz().get('/', 'Hello from factory!').listen(3000);
```

## Routes

One method per HTTP verb: `get`, `post`, `put`, `delete`, `patch`, `options`, `head`. All take `(pattern, handler)` and return `this` for chaining.

`pattern` supports named params (`:id`) and a trailing wildcard (`*`):

```typescript
app.get('/users/:id', (ctx) => ctx.params.id);
app.get('/files/*', (ctx) => ctx.req.getUrl());
```

`handler` is a **SimpleHandler** - whatever you pass is auto-serialized:

| You pass | Response |
|---|---|
| `string` / `number` / `boolean` / `null` | sent as `text/plain` |
| plain object / array | sent as `application/json` |
| function returning one of the above (sync or async) | same rules applied to the return value |
| function that writes to `ctx.res` itself and returns `undefined` | nothing extra is sent - your code owns the response |

```typescript
app.get('/ping', 'pong');                              // text/plain
app.get('/config', { debug: false });                   // application/json
app.get('/time', () => new Date().toISOString());       // text/plain
app.get('/raw', (ctx) => {
  ctx.res.writeHeader('Content-Type', 'text/csv');
  ctx.res.end('a,b,c');
});
```

Static routes (no `:`/`*` in the pattern) are looked up in O(1) via a `Map`; dynamic routes are matched in registration order against a compiled regex.

## RouteContext

Every handler and middleware receives a `RouteContext`:

```typescript
interface RouteContext {
  req: HttpRequest;                 // raw uWebSockets.js request
  res: HttpResponse;                // raw uWebSockets.js response
  params: Record<string, string>;   // extracted from the route pattern
  query: Record<string, string>;    // parsed query string
  body?: unknown;                   // parsed for POST/PUT/PATCH, see below
}
```

`body` parsing is automatic for `POST`/`PUT`/`PATCH`:
- `Content-Type: application/json` -> parsed with `JSON.parse`
- `Content-Type: application/x-www-form-urlencoded` -> parsed into a `Record<string, string>`
- anything else -> raw string
- if parsing fails, `body` falls back to the raw string

## Middleware

```typescript
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  console.log(`${ctx.req.getMethod()} ${ctx.req.getUrl()} - ${Date.now() - start}ms`);
});
```

- Middlewares run in registration order, wrapping the matched route handler.
- Call `await next()` to continue the chain; **not** calling it short-circuits the request (the route handler never runs) - useful for auth guards:

```typescript
app.use(async (ctx, next) => {
  if (!ctx.req.getHeader('authorization')) {
    ctx.res.writeStatus('401 Unauthorized').end('Unauthorized');
    return; // no next() -> route handler is skipped
  }
  await next();
});
```

## Sub-applications

Build a piece of your API in isolation and mount it under a prefix:

```typescript
const api = new BlitzJS({ prefix: '/api' })
  .get('/health', 'ok')
  .get('/users/:id', (ctx) => ({ id: ctx.params.id }));

const app = new BlitzJS()
  .use(api)          // routes become GET /api/health, GET /api/users/:id
  .listen(3000);
```

A sub-app (created with `{ prefix }`) has no uWebSockets.js instance of its own and cannot call `.listen()` - it only exists to be `.use()`d into a main app. Its middlewares are merged into the parent's chain (run before the parent's own routes) and its routes (static and dynamic) are re-registered on the parent with the prefix applied.

## Authentication

BlitzJS ships auth helpers that you can attach as middleware:
- `requireSessionAuth()` checks a value in `ctx.session` (defaults to `ctx.session.user`)
- `requireBearerAuth()` checks `Authorization: Bearer <token>`
- `requireBasicAuth()` checks `Authorization: Basic <base64>`

Because routes accept `(pattern, handler)`, the clean way to apply auth to a subset of routes is using prefixed sub-apps:

```typescript
import {
  BlitzJS,
  session,
  requireSessionAuth,
  requireBearerAuth,
  requireBasicAuth
} from '@damienmonchaty/blitzjs';

const sessionProtected = new BlitzJS({ prefix: '/session' })
  .use(requireSessionAuth())
  .get('/me', (ctx) => ({ user: ctx.session!.user }));

const bearerProtected = new BlitzJS({ prefix: '/bearer' })
  .use(requireBearerAuth({
    realm: 'api',
    verifyToken: (token) => token === 'demo-token-123'
  }))
  .get('/protected', () => ({ ok: true, auth: 'bearer' }));

const basicProtected = new BlitzJS({ prefix: '/basic' })
  .use(requireBasicAuth({
    realm: 'admin',
    verifyCredentials: (username, password) => username === 'admin' && password === 'secret'
  }))
  .get('/protected', () => ({ ok: true, auth: 'basic' }));

new BlitzJS()
  .use(session({ maxAge: 60 * 60 }))
  .use(sessionProtected)
  .use(bearerProtected)
  .use(basicProtected)
  .post('/login', (ctx) => {
    ctx.session!.user = { id: 1, name: 'Ada' };
    return { loggedIn: true };
  })
  .listen(4100);
```

Helpers also expose parsing utilities when you need custom logic:
- `getAuthorizationHeader(ctx)`
- `getBearerToken(ctx)`
- `getBasicCredentials(ctx)`

## Database integrations

BlitzJS stays database-agnostic. You can attach any client/ORM (Prisma, Drizzle, Mongoose, Knex, native drivers) with:
- `database(clientOrFactory, options?)`
- `getDatabase(ctx, name?)`
- `requireDatabase(ctx, name?)`

The integration stores your client in `ctx.state` and does not enforce a specific library.

```typescript
import { BlitzJS, database, requireDatabase } from '@damienmonchaty/blitzjs';

type DbClient = {
  users: {
    findById: (id: string) => Promise<{ id: string; name: string } | null>;
  };
};

const dbClient: DbClient = {
  users: {
    findById: async (id) => ({ id, name: 'Ada' })
  }
};

new BlitzJS()
  .use(database(dbClient))
  .get('/users/:id', async (ctx) => {
    const db = requireDatabase<DbClient>(ctx);
    const user = await db.users.findById(ctx.params.id);
    return user ?? { error: 'Not found' };
  })
  .listen(3000);
```

For named/multiple clients:

```typescript
app
  .use(database(primaryClient, { name: 'primaryDb' }))
  .use(database(analyticsClient, { name: 'analyticsDb' }));

const primary = requireDatabase<typeof primaryClient>(ctx, 'primaryDb');
```

## Static files

```typescript
import { BlitzJS, staticFile } from '@damienmonchaty/blitzjs';

app.get('/favicon.ico', staticFile('./public/favicon.ico'));
```

`staticFile(path)` returns a handler that serves the file with the right `Content-Type` (guessed from the extension) and a `404` if it doesn't exist. `BlitzJS.file(path)` is kept as an alias for backwards compatibility.

## Advanced: the raw uWebSockets.js app

```typescript
const app = new BlitzJS();
const uws = app.getUwsApp(); // TemplatedApp, or null for a sub-app
```

Use this to reach uWebSockets.js features BlitzJS doesn't wrap (e.g. WebSockets).

## Project layout

The framework is split by concern under `src/core/`:

| File | Responsibility |
|---|---|
| `types.ts` | Public types (`RouteContext`, `BlitzConfig`, `Route`, handler/middleware signatures) |
| `pattern.ts` | Compiles a route pattern into a regex + param names |
| `simple-handler.ts` | Wraps a `SimpleHandler` into a `RouteHandlerFunction` with auto-serialization |
| `templates.ts` | Compiles the optimized "template" handler for a route (string/JSON/function) |
| `middleware.ts` | Runs the middleware chain (`next()` continuation) |
| `body.ts` | Request body and query string parsing |
| `auth.ts` | Authentication helpers (`requireSessionAuth`, `requireBearerAuth`, `requireBasicAuth`) |
| `database.ts` | Database integration helpers (`database`, `getDatabase`, `requireDatabase`) |
| `static-file.ts` | `staticFile()` helper |
| `BlitzJS.ts` | The `BlitzJS` class: routing table, request dispatch, public API |

`src/index.ts` re-exports the public API from `BlitzJS.ts`.
