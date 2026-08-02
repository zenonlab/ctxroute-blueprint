import { existsSync, readFileSync } from 'node:fs'; import { Client } from 'pg';
const url = process.env.DATABASE_URL ?? 'postgres://favlib:favlib@localhost:5432/favlib';
const client = new Client({connectionString:url}); await client.connect();
for (const name of ['0001_wave1.sql','0002_wave3_extension.sql']) { const relative=`../../../packages/database/migrations/${name}`; const compiledRelative=`../../../../packages/database/migrations/${name}`; const file=existsSync(new URL(relative,import.meta.url))?new URL(relative,import.meta.url):new URL(compiledRelative,import.meta.url); await client.query(readFileSync(file,'utf8')); } await client.end(); console.log('migrations applied');
