# BlitzJS ⚡

Ultra-fast HTTP framework with Elysia-like API built on uWebSockets.js

## Features

- ⚡ **Lightning Fast** - Built on uWebSockets.js, one of the fastest HTTP servers
- 🎯 **Elysia-like API** - Clean, chainable syntax inspired by Elysia
- 🔧 **TypeScript First** - Full TypeScript support with excellent type inference  
- 📦 **Zero Dependencies** - Only uWebSockets.js as peer dependency
- 🚀 **Auto Response** - Automatic JSON/string response handling

## Installation

```bash
npm install blitzjs
```

## Quick Start

```typescript
import { BlitzJS } from 'blitzjs';

new BlitzJS()
  .get('/', 'Hello BlitzJS!')
  .get('/json', { message: 'Auto JSON response!' })
  .get('/user/:id', (ctx) => ({ 
    id: ctx.params.id, 
    name: `User ${ctx.params.id}` 
  }))
  .listen(3000);
```

## API

### Simple Responses

```typescript
// String response
.get('/', 'Hello World!')

// JSON response  
.get('/data', { key: 'value' })

// Function response
.get('/time', () => new Date().toISOString())

// Dynamic response
.get('/user/:id', (ctx) => ({ id: ctx.params.id }))
```

### HTTP Methods

```typescript
new BlitzJS()
  .get('/users', () => getAllUsers())
  .post('/users', (ctx) => createUser(ctx.body))
  .put('/users/:id', (ctx) => updateUser(ctx.params.id))
  .delete('/users/:id', (ctx) => deleteUser(ctx.params.id))
  .listen(3000);
```

### Context

Route handlers receive a context object:

```typescript
interface RouteContext {
  req: HttpRequest;      // uWebSockets.js request
  res: HttpResponse;     // uWebSockets.js response  
  params: Record<string, string>;  // Route parameters
  query: Record<string, string>;   // Query parameters
  body?: any;           // Request body (if parsed)
}
```

### Middleware

```typescript
import { BlitzJS } from 'blitzjs';

const app = new BlitzJS()
  .use(async (ctx, next) => {
    console.log(`${ctx.req.getMethod()} ${ctx.req.getUrl()}`);
    await next();
  })
  .get('/', 'Hello with middleware!')
  .listen(3000);
```

### Factory Function

```typescript
import { Blitz } from 'blitzjs';

// Use the factory function for a more functional approach
const app = Blitz()
  .get('/', 'Hello from factory!')
  .listen(3000);
```

## Performance

BlitzJS leverages uWebSockets.js and advanced optimizations to deliver exceptional performance:

### 🔥 Ultra-Performance Features

- **Template Pattern Handler Generation** - Eliminates closures, reuses optimized templates
- **O(1) Static Route Lookup** - HashMap-based routing for static routes
- **O(log n) Dynamic Route Lookup** - Optimized trie-based routing for dynamic routes
- **Runtime Code Generation** - JIT-compiled handlers for maximum performance
- **Pre-computed Headers** - Eliminates header computation overhead
- **Ultra-Fast Router** - Compiled dispatch function for minimal overhead

### 📊 Benchmark Results

Latest performance validation with Template Pattern optimizations:

| Route Type | Req/s | Latency P50 | Optimization |
|------------|-------|-------------|--------------|
| Static String | 66,005 | 13ms | Template + O(1) HashMap |
| Static JSON | 60,370 | 15ms | Template + O(1) HashMap |
| Dynamic Single Param | 55,806 | 14ms | Template + Optimized Regex |
| Dynamic Multi Param | 48,547 | 16ms | Template + Complex Regex |

*Tested with autocannon: 100 connections, 10 pipelining, 10s duration*

### 🚀 Performance Optimizations

- **Template Pattern**: Handler templates compiled once, reused without closures
- **Static Route HashMap**: O(1) lookup for static routes
- **Dynamic Route Trie**: O(log n) lookup with optimized regex patterns
- **Pre-computed Responses**: Headers and common responses cached
- **JIT Compilation**: Runtime code generation for optimal V8 optimization

## Template Pattern Architecture

BlitzJS uses the **Template Pattern** for handler generation, achieving maximum performance by eliminating closures and enabling optimal V8 optimization:

### Traditional Closure-based Approach
```typescript
// ❌ Creates closures for each handler - less optimal
const createHandler = (response) => {
  return (ctx) => {
    ctx.res.end(response); // Closure captures response
  };
};
```

### BlitzJS Template Pattern Approach  
```typescript
// ✅ Reusable templates without closures - ultra-optimized
const stringTemplate = function(ctx, precomputedResponse, precomputedHeaders) {
  ctx.res.writeHeader('content-type', 'text/plain; charset=utf-8');
  ctx.res.end(precomputedResponse);
};

// All handlers use the same optimized template function
```

### Benefits

- **Zero Closures** - Templates are reused, no closure overhead
- **V8 Optimization** - Templates get heavily optimized by V8 JIT
- **Memory Efficiency** - Single template function for all similar handlers
- **Pre-computed Data** - Responses and headers computed at compile time
- **Maximum Performance** - Benchmarks show ~69,000 req/s throughput

## Examples

See the `example/` directory:

- `blitz-style.ts` - Complete BlitzJS example with various features

## License

MIT

---

**BlitzJS** - When you need speed ⚡
