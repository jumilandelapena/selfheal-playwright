import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PlaywrightTestConfig } from '@playwright/test';

export interface WebServerConfig {
  command: string;
  url?: string;
  port?: number;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface LoadedConfig {
  configPath: string;
  testDir: string;
  baseURL?: string;
  webServer?: WebServerConfig;
}

const DEFAULT_NAMES = ['playwright.config.ts', 'playwright.config.mts', 'playwright.config.js', 'playwright.config.mjs'];

/** Import the project's Playwright config to learn the base URL, test dir and web server. */
export async function loadPlaywrightConfig(cwd: string, configPath?: string): Promise<LoadedConfig> {
  const candidates = configPath ? [path.resolve(cwd, configPath)] : DEFAULT_NAMES.map((name) => path.join(cwd, name));
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`No Playwright config found (looked for ${candidates.join(', ')})`);

  const module = (await import(pathToFileURL(found).href)) as { default?: PlaywrightTestConfig };
  const config: PlaywrightTestConfig = module.default ?? (module as PlaywrightTestConfig);
  const rawServer = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;

  return {
    configPath: found,
    testDir: path.resolve(path.dirname(found), config.testDir ?? '.'),
    ...(config.use?.baseURL ? { baseURL: config.use.baseURL } : {}),
    ...(rawServer
      ? {
          webServer: {
            command: rawServer.command,
            ...(rawServer.url ? { url: rawServer.url } : {}),
            ...(rawServer.port ? { port: rawServer.port } : {}),
            ...(rawServer.cwd ? { cwd: rawServer.cwd } : {}),
            ...(rawServer.env ? { env: rawServer.env } : {}),
            ...(rawServer.timeout ? { timeout: rawServer.timeout } : {}),
          },
        }
      : {}),
  };
}
