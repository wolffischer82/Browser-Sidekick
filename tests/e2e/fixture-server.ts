import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, resolve } from 'node:path';

/** HTML fixture pages (`tests/fixtures/pages`) served from 127.0.0.1. Prints nothing. */
const PAGES_DIR = resolve(import.meta.dirname, '../fixtures/pages');

export interface FixtureServer {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  url(page: string): string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server = createServer((req, res) => {
    const name = basename(new URL(req.url ?? '/', 'http://x').pathname);
    readFile(resolve(PAGES_DIR, name)).then(
      (body) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body);
      },
      () => {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
      },
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${String(port)}`;
  return {
    origin,
    url: (page) => `${origin}/${page}`,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => {
          done();
        });
      }),
  };
}
