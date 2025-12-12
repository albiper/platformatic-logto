import { LogToFastifyInstance } from '@albirex/fastify-logto';
import type { Entities } from '@platformatic/db'
import { SQLMapperPluginInterface } from '@platformatic/sql-mapper';
import { AddAuthStrategyDecorator, CreateJWTSessionDecorator, CreateSessionDecorator, CreateWebhookSessionDecorator, ExtractUserDecorator } from 'fastify-user';
import { PlatformaticLogtoAuthOptions, PlatformaticRule } from './src/index.ts';
declare module 'fastify' {
  interface FastifyInstance {
    platformaticLogTo: {
      opts: PlatformaticLogtoAuthOptions
    },
    platformatic: SQLMapperPluginInterface<Entities> & {
      rules?: PlatformaticRule[]
    };
    logto: LogToFastifyInstance;
    addAuthStrategy: AddAuthStrategyDecorator
  }

  interface FastifyRequest {
    extractUser: ExtractUserDecorator
    createSession: CreateSessionDecorator
    createJWTSession: CreateJWTSessionDecorator
    createWebhookSession: CreateWebhookSessionDecorator
  }
}

declare module '@platformatic/sql-mapper' {
  type EntityHook<T extends (...args: any) => any> = (original: T, ...options: Parameters<T>) => ReturnType<T>
}