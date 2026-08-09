import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { collectSnapshot } from './collect.js';

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/plain/chapter-2') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><head><title>Read Fixture Chapter 2</title></head><body>site markup without connector data attributes</body></html>');
      return;
    }
    response.writeHead(404);
    response.end();
  }).listen(0);
  await new Promise<void>(resolve => server.once('listening', () => {
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    resolve();
  }));
});

afterAll(() => server.close());

describe('source signal quarantine policy', () => {
  it('does not quarantine an accessible page only because its HTML lacks connector attributes', async () => {
    const snapshot = await collectSnapshot({ target: `${base}/plain/chapter-2`, mediaId: 'm1', connector: 'fixture', connectorVersion: '1', policy: { approvedDomains: ['127.0.0.1'], allowPrivateTest: true } });
    expect(snapshot.status).toBe('VALID');
    expect(snapshot.origins[0]).toMatchObject({ mediaId: 'm1', sequence: { raw: '2' } });
  });
});
