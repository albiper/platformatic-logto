import type { PlatformaticApp, PlatformaticDBConfig } from '@platformatic/db'
declare module 'fastify' {
  interface FastifyInstance {
    platformatic: PlatformaticApp<PlatformaticDBConfig>;
  }
}
