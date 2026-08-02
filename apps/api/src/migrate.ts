import { readFileSync } from 'node:fs'; import { Client } from 'pg';
const url = process.env.DATABASE_URL ?? 'postgres://favlib:favlib@localhost:5432/favlib';
const client = new Client({connectionString:url}); await client.connect();
const sql=readFileSync(new URL('../../../packages/database/migrations/0001_wave1.sql',import.meta.url),'utf8'); await client.query(sql); await client.end(); console.log('migrations applied');
