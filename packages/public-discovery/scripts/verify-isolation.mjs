import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? sourceFiles(join(directory, entry.name))
    : Promise.resolve(extname(entry.name) === '.ts' ? [join(directory, entry.name)] : [])));
  return nested.flat();
}

const files = await sourceFiles(fileURLToPath(new URL('../src', import.meta.url)));
for (const file of files) {
  const source = await readFile(file, 'utf8');
  if (/from\s+['"]@tobirink\//u.test(source)) throw new Error(`private-package-import:${file}`);
  if (/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|gh[ps]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./u.test(source)) {
    throw new Error(`credential-shaped-literal:${file}`);
  }
}
process.stdout.write(`${JSON.stringify({ files: files.length, isolated: true })}\n`);
