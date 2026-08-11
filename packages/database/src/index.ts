import { drizzle } from 'drizzle-orm/node-postgres'; import { Pool } from 'pg';
export * from './schema.js';
export * from './runtime.js';
export * from './provider-queue.js';
export * from './resolved-review-repair.js';
export * from './anime-season-link-repair.js';
export * from './obsolete-installation-cleanup.js';
export function createDatabase(url: string) { const pool = new Pool({connectionString:url}); return { db: drizzle(pool), pool }; }
