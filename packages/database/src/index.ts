import { drizzle } from 'drizzle-orm/node-postgres'; import { Pool } from 'pg';
export * from './schema.js';
export function createDatabase(url: string) { const pool = new Pool({connectionString:url}); return { db: drizzle(pool), pool }; }
