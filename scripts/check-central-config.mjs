import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root=new URL('../',import.meta.url);
const violations=[];
const allowedEnvironment=new Set(['packages/config/src/index.ts','packages/database/drizzle.config.ts']);
const ignoredFiles=new Set(['scripts/check-central-config.mjs']);
const ignored=new Set(['node_modules','.git','.next','dist','build','coverage']);
async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){if(ignored.has(entry.name))continue;const path=join(directory,entry.name);if(entry.isDirectory()){await walk(path);continue}if(!/\.(?:ts|tsx|js|mjs)$/.test(entry.name)||/\.test\./.test(entry.name))continue;const name=relative(root.pathname,path);if(ignoredFiles.has(name))continue;const source=await readFile(path,'utf8');if(source.includes('postgres://favlib:favlib@localhost:5432/favlib'))violations.push(`${name}: PostgreSQL production fallback`);if(source.includes('process.env')&&!allowedEnvironment.has(name))violations.push(`${name}: direct process.env access`);if(name!=='packages/config/src/index.ts'&&source.includes('source-pending'))violations.push(`${name}: technical format marker`)}}
await walk(root.pathname);
if(violations.length){console.error(violations.join('\n'));process.exitCode=1}else console.log('central configuration guard: ok');
