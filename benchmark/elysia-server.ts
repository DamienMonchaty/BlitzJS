import { Elysia } from 'elysia';

new Elysia()
  .get('/', () => 'Hello BlitzJS!')
  .get('/json', () => ({ message: 'Auto JSON response!' }))
  .get('/user/:id', ({ params }) => ({
    id: params.id,
    name: `User ${params.id}`,
  }))
  .listen(4001);
