import { run } from 'graphile-worker';
const connectionString=process.env.DATABASE_URL??'postgres://favlib:favlib@localhost:5432/favlib';
if(process.env.NODE_ENV!=='test') await run({connectionString,taskDirectory:new URL('./tasks',import.meta.url).pathname});
