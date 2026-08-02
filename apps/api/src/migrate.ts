import { readFileSync } from 'node:fs'; import { Client } from 'pg';
const url = process.env.DATABASE_URL ?? 'postgres://favlib:favlib@localhost:5432/favlib';
const client = new Client({connectionString:url}); await client.connect();
for (const name of ['0001_wave1.sql','0002_wave3_extension.sql']) { const sql=readFileSync(new URL(`../../../packages/database/migrations/${name}`,import.meta.url),'utf8'); await client.query(sql); } await client.end(); console.log('migrations applied');
