import { BlitzJS } from '../.bench-old-core/BlitzJS.js';

new BlitzJS()
  .get('/', 'Hello BlitzJS!')
  .get('/json', { message: 'Auto JSON response!' })
  .get('/user/:id', (ctx) => ({ id: ctx.params.id, name: `User ${ctx.params.id}` }))
  .listen(4041);
