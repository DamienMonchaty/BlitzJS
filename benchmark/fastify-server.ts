import Fastify from 'fastify';

const app = Fastify();

app.get('/', (_req, reply) => reply.send('Hello BlitzJS!'));
app.get('/json', (_req, reply) => reply.send({ message: 'Auto JSON response!' }));
app.get('/user/:id', (req, reply) => {
  const { id } = req.params as { id: string };
  reply.send({ id, name: `User ${id}` });
});

app.listen({ port: 4002 });
