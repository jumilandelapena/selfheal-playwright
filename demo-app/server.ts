/**
 * Tiny dependency-free HTTP server for the Taskly demo app.
 *
 *   APP_VERSION=1 (default) serves the original markup
 *   APP_VERSION=2 serves the renamed markup that breaks most v1 locators
 *
 * Run it directly (`pnpm dev`) or import `startDemoServer()`; the healer
 * and the vitest end-to-end test start it in-process.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVariant, normaliseVersion, type AppVersion } from './variants.js';
import { renderLogin, renderSettings, renderTodos } from './pages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');

export interface DemoServer {
  url: string;
  port: number;
  version: AppVersion;
  close(): Promise<void>;
}

export interface DemoServerOptions {
  /** Port to listen on. Defaults to $PORT or 4173. */
  port?: number;
  /** "1" or "2". Defaults to $APP_VERSION or "1". */
  version?: string;
}

const STATIC: Record<string, { file: string; type: string }> = {
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};

export async function startDemoServer(options: DemoServerOptions = {}): Promise<DemoServer> {
  const version = normaliseVersion(options.version ?? process.env.APP_VERSION);
  const port = options.port ?? Number(process.env.PORT ?? 4173);
  const variant = getVariant(version);

  const pages: Record<string, () => string> = {
    '/login': () => renderLogin(variant),
    '/todos': () => renderTodos(variant),
    '/settings': () => renderSettings(variant),
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname;

    if (route === '/') {
      res.writeHead(302, { location: '/login' });
      res.end();
      return;
    }
    if (route === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version }));
      return;
    }
    const page = pages[route];
    if (page) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(page());
      return;
    }
    const asset = STATIC[route];
    if (asset) {
      const body = await readFile(path.join(publicDir, asset.file));
      res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });

  return {
    url: `http://localhost:${port}`,
    port,
    version,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const entry = process.argv[1] ? path.resolve(process.argv[1]).toLowerCase() : '';
if (entry === fileURLToPath(import.meta.url).toLowerCase()) {
  const server = await startDemoServer();
  console.log(`Taskly demo app v${server.version} listening on ${server.url}`);
}
