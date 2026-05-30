import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true, // allow all origins in dev
});

// Routes
import healthRoutes from './routes/health.js';
import skillRoutes from './routes/skills.js';
import chatRoutes from './routes/chat.js';
import agentRoutes from './routes/agents.js';
app.register(healthRoutes, { prefix: '/v1' });
app.register(skillRoutes, { prefix: '/v1' });
app.register(chatRoutes, { prefix: '/v1' });
app.register(agentRoutes, { prefix: '/v1' });

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`LexAI Backend running on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}