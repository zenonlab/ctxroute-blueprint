import { readFileSync,readdirSync,statSync } from 'node:fs';
import { join } from 'node:path';

const roots=['packages/database/migrations','apps/worker/src/tasks'];
const forbidden=/DELETE\s+FROM\s+(?:media_cover|media_banner|catalog_image_asset)/i;
const failures=[];
function visit(path){for(const name of readdirSync(path)){const file=join(path,name),info=statSync(file);if(info.isDirectory())visit(file);else if(/\.(?:sql|ts)$/.test(name)&&forbidden.test(readFileSync(file,'utf8')))failures.push(file)}}
for(const root of roots)visit(root);
if(failures.length){console.error(`Automatic image deletion is forbidden:\n${failures.join('\n')}`);process.exit(1)}
console.log('Image safety gate: OK');
