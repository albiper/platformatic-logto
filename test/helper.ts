'use strict'

import { readFile } from 'node:fs/promises'
import core from '@platformatic/db-core'
import { config } from 'dotenv';
import fastify from 'fastify';
import { Test } from 'tap';
import { join } from 'node:path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({
  path: join(__dirname, '.env'),
})

export const adminSecret = 'admin';
export const authBaseConfig = {
  jwtPlugin: {
    jwt: {
      secret: 'supersecret',
      // jwks: {
      //     allowedDomains: [
      //         "http://localhost:3001/oidc",
      //     ],
      //     "providerDiscovery": true
      // }
    },
  },
  allowAnonymous: false,
  adminSecret,
  roleKey: 'X-PLATFORMATIC-ROLE',
  anonymousRole: 'anonymous',
  logtoBaseUrl: 'http://localhost:3001',
  logtoAppId: 'x33chy0wqu70iwr1is2i0', // Replace with your own appId
  logtoAppSecret: 'lQ7Jnme0z4xrlzAWPIAFirxjQAVf34xU', // Replace with your own appSecret
}

export async function getServer(t: Test) {
  const config = JSON.parse(await readFile(join(__dirname, 'platformatic.json'), 'utf8'))
  config.server ||= {}
  config.server.logger ||= {}
  config.watch = false

  config.migrations.autoApply = true
  config.types.autogenerate = false

  const server = fastify();
  server.register(core, {
    ...connInfo,
    events: false,
    async onDatabaseLoad(db, sql) {
      t.ok('onDatabaseLoad called')

      await clear(db, sql)
      await createBasicPages(db, sql)
    },
  });
  t.after(() => server.close())

  return server
}

export async function clear(db, sql) {
  try {
    await db.query(sql`DROP TABLE IF EXISTS pages CASCADE`)
  } catch (err) {
    console.error(err);
  }
  try {
    await db.query(sql`DROP TABLE IF EXISTS categories CASCADE`)
  } catch (err) {
    console.error(err);
  }
}

export const connInfo: { connectionString?: string, poolSize?: number } = {}
export let isPg = false;
export let isMysql = false;
export let isSQLite = false;

if (!process.env.DB || process.env.DB === 'postgresql') {
  connInfo.connectionString = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1/postgres'
  isPg = true
} else if (process.env.DB === 'mariadb') {
  connInfo.connectionString = 'mysql://root@127.0.0.1:3307/graph'
  connInfo.poolSize = 10
  isMysql = true
} else if (process.env.DB === 'mysql') {
  connInfo.connectionString = 'mysql://root@127.0.0.1/graph'
  connInfo.poolSize = 10
  isMysql = true
} else if (process.env.DB === 'mysql8') {
  connInfo.connectionString = 'mysql://root@127.0.0.1:3308/graph'
  connInfo.poolSize = 10
  isMysql = true
} else if (process.env.DB === 'sqlite') {
  connInfo.connectionString = 'sqlite://:memory:'
  isSQLite = true
}

export async function createBasicPages(db, sql) {
  if (isSQLite) {
    await db.query(sql`CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY,
      title VARCHAR(42),
      user_id INTEGER
    );`)
  } else {
    await db.query(sql`CREATE TABLE IF NOT EXISTS pages (
      id SERIAL PRIMARY KEY,
      title VARCHAR(42),
      user_id INTEGER
    );`)
  }
}