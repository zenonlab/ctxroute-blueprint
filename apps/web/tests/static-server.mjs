import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputRoot = join(dirname(fileURLToPath(import.meta.url)), '../out');
const routes = new Map([
  ['/', 'index.html'],
  ['/agenda', 'agenda.html'],
  ['/download', 'download.html'],
  ['/library', 'library.html'],
  ['/library/_', 'library/_.html'],
  ['/privacy', 'privacy.html'],
]);
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function extension(pathname) {
  const index = pathname.lastIndexOf('.');
  return index === -1 ? '' : pathname.slice(index);
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:4173');
  const routeFile = routes.get(url.pathname);
  const assetFile = url.pathname.startsWith('/_next/static/') && !url.pathname.includes('..')
    ? url.pathname.slice(1)
    : undefined;
  const file = routeFile ?? assetFile ?? '404.html';
  try {
    const body = await readFile(join(outputRoot, file));
    response.writeHead(routeFile || assetFile ? 200 : 404, {
      'Cache-Control': 'no-store',
      'Content-Type': mimeTypes.get(extension(file)) ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Static export unavailable. Run the web build first.');
  }
}).listen(4173, '127.0.0.1');
