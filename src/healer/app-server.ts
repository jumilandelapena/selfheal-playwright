/**
 * Make sure the application under test is reachable before the healer opens
 * pages against it. Mirrors Playwright's `webServer` behaviour: reuse a
 * running server, otherwise start the configured command and wait for it.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { WebServerConfig } from './config.js';
import type { Logger } from './log.js';

export interface AppServerHandle {
  url: string;
  /** True when the healer started the server itself (and will stop it). */
  started: boolean;
  stop(): Promise<void>;
}

const READY_STATUSES = new Set([200, 201, 202, 203, 204, 205, 206, 300, 301, 302, 303, 304, 307, 308, 400, 401, 402, 403]);

export async function isReachable(url: string, timeoutMs = 2_000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    return READY_STATUSES.has(response.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface EnsureAppServerOptions {
  cwd: string;
  baseUrl: string;
  webServer?: WebServerConfig;
  env?: NodeJS.ProcessEnv;
  log: Logger;
}

export async function ensureAppServer(options: EnsureAppServerOptions): Promise<AppServerHandle> {
  const { webServer, log } = options;
  const url = webServer?.url ?? (webServer?.port ? `http://localhost:${webServer.port}` : options.baseUrl);

  if (await isReachable(url)) {
    log.debug(`app already running at ${url}`);
    return { url, started: false, stop: async () => {} };
  }
  if (!webServer) {
    throw new Error(`${url} is not reachable and the Playwright config has no webServer to start`);
  }

  log.step(`Starting app server: ${webServer.command}`);
  const child = spawn(webServer.command, {
    cwd: webServer.cwd ?? options.cwd,
    env: { ...process.env, ...webServer.env, ...options.env },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdout?.on('data', (chunk: Buffer) => log.debug(`[app] ${chunk.toString().trim()}`));
  child.stderr?.on('data', (chunk: Buffer) => log.debug(`[app] ${chunk.toString().trim()}`));

  const deadline = Date.now() + (webServer.timeout ?? 60_000);
  while (!(await isReachable(url))) {
    if (child.exitCode !== null) throw new Error(`app server exited with code ${child.exitCode} before becoming ready`);
    if (Date.now() > deadline) {
      killTree(child);
      throw new Error(`app server did not become ready at ${url} in time`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  log.debug(`app server ready at ${url}`);
  return {
    url,
    started: true,
    stop: async () => {
      killTree(child);
      await new Promise((resolve) => setTimeout(resolve, 100));
    },
  };
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}
