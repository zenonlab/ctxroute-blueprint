import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { Client } from 'pg';
import { runtimeEnvironment } from '@favlib/config';
import { BOOTSTRAP_SCHEMA_VERSION, inspectRuntimeSchema } from './runtime-schema.js';
import { runMigrations } from 'graphile-worker';

const url=runtimeEnvironment().databaseUrl;
const relative=new URL('../../../packages/database/bootstrap/anilist.sql',import.meta.url);
const compiled=new URL('../../../../packages/database/bootstrap/anilist.sql',import.meta.url);
const schema=new Client({connectionString:url});
await schema.connect();
const file=existsSync(relative)?relative:compiled;
await schema.query(readFileSync(file, 'utf8'));
await schema.end();
await runMigrations({connectionString:url});
const verify=new Client({connectionString:url});
await verify.connect();
await verify.query('CREATE TABLE IF NOT EXISTS favlib_sql_migration(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
const migrationsDir=new URL('../../../packages/database/migrations/',import.meta.url);
const compiledMigrationsDir=new URL('../../../../packages/database/migrations/',import.meta.url);
const migrationDir=existsSync(migrationsDir)?migrationsDir:compiledMigrationsDir;
for(const name of readdirSync(migrationDir).filter(value=>value.endsWith('.sql')).sort()){const already=await verify.query('SELECT 1 FROM favlib_sql_migration WHERE name=$1',[name]);if(already.rowCount)continue;await verify.query('BEGIN');try{await verify.query(readFileSync(new URL(name,migrationDir),'utf8'));await verify.query('INSERT INTO favlib_sql_migration(name) VALUES($1)',[name]);await verify.query('COMMIT')}catch(error){await verify.query('ROLLBACK');throw error}}
const state=await inspectRuntimeSchema(verify);
if(!state.ok) { await verify.end(); throw new Error(`Schéma insuffisant, tables absentes: ${state.missing.join(', ')}`); }
await verify.query('CREATE TABLE IF NOT EXISTS favlib_runtime_schema(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
await verify.query('INSERT INTO favlib_runtime_schema(version) VALUES($1) ON CONFLICT DO NOTHING',[BOOTSTRAP_SCHEMA_VERSION]);
await verify.end();
console.log(JSON.stringify({status:'ok',schemaVersion:BOOTSTRAP_SCHEMA_VERSION,requiredTables:state.required}));
