import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, resolve } from 'node:path';

/** HTML fixture pages (`tests/fixtures/pages`) served from 127.0.0.1. Prints nothing. */
const PAGES_DIR = resolve(import.meta.dirname, '../fixtures/pages');
/**
 * Fixture PDFs (`tests/fixtures/pdf`, T09): `/pdf/<name>.pdf`, the same files
 * behind a URL without `.pdf` at `/view/<name>` (detection by Content-Type),
 * and `/pdf/huge.pdf`, which announces 31 MB and never sends them.
 */
const PDF_DIR = resolve(import.meta.dirname, '../fixtures/pdf');
const HUGE_PDF_BYTES = 31 * 1024 * 1024;

export interface FixtureServer {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  /** The path of every request received, in order (paths only). */
  requests: string[];
  url(page: string): string;
  /**
   * Holds back the body of `/slow.html` (its head and title arrive at once)
   * until the returned function is called, so the page stays loading.
   */
  holdSlowPage(): () => void;
  close(): Promise<void>;
}

const SLOW_HEAD =
  '<!doctype html><html lang="en"><head><meta charset="utf-8" />' +
  '<title>Quarterly rail report</title><link rel="icon" href="data:," /></head><body>';
const SLOW_BODY =
  '<article><h1>Quarterly rail report</h1>' +
  '<p>Passenger numbers on night routes grew again this quarter, led by new cross-border services.</p>' +
  '<p>Operators plan more sleeper carriages for the winter timetable.</p></article></body></html>';

export async function startFixtureServer(): Promise<FixtureServer> {
  let slowGate: Promise<void> = Promise.resolve();
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    requests.push(path);
    const name = basename(path);
    if (path === '/pdf/huge.pdf') {
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': String(HUGE_PDF_BYTES),
      });
      res.write('%PDF-1.4\n');
      return;
    }
    if (path.startsWith('/pdf/') || path.startsWith('/view/')) {
      const file = path.startsWith('/pdf/') ? name : `${name}.pdf`;
      readFile(resolve(PDF_DIR, file)).then(
        (body) => {
          res.writeHead(200, { 'content-type': 'application/pdf' });
          res.end(body);
        },
        () => {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('Not found');
        },
      );
      return;
    }
    if (name === 'slow.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.write(SLOW_HEAD);
      void slowGate.then(() => {
        res.end(SLOW_BODY);
      });
      return;
    }
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
    requests,
    url: (page) => `${origin}/${page}`,
    holdSlowPage: () => {
      let release: () => void = () => undefined;
      slowGate = new Promise<void>((done) => {
        release = done;
      });
      return release;
    },
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => {
          done();
        });
      }),
  };
}
