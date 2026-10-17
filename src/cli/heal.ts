#!/usr/bin/env node
/**
 * `pnpm heal` — run the self-healing agent from the command line.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { heal } from '../healer/heal.js';
import { colors, createLogger } from '../healer/log.js';
import { createProvider, type ProviderName } from '../healer/providers/index.js';
import type { Effort } from '../healer/providers/anthropic.js';

const HELP = `selfheal-playwright — repair broken Playwright locators with an AI agent

Usage: pnpm heal [options]

Options:
  --provider <anthropic|mock>  AI provider (default: anthropic; mock needs no API key)
  --dry-run                    patch, verify, print the diff, then restore the files; no commit, no PR
  --max-heals <n>              maximum locator patches per run (default: 5)
  --min-confidence <0-1>       ignore candidates below this confidence (default: 0.7)
  --files <glob>               allowlist of spec files, repeatable or comma-separated
                               (default: every spec under the Playwright testDir)
  --max-rounds <n>             maximum run → heal rounds (default: 5)
  --out <dir>                  output directory for reports and screenshots (default: heal-output)
  --base-url <url>             app URL (default: use.baseURL from the Playwright config)
  --config <path>              Playwright config file (default: ./playwright.config.ts)
  --mock-answers <file>        JSON answers for the mock provider
  --effort <low|medium|high>   reasoning effort for the Anthropic provider (default: low)
  --no-pr                      patch the files but do not open a pull request
  --verbose                    print debug output
  -h, --help                   show this help

Environment:
  ANTHROPIC_API_KEY  required for --provider anthropic
  GITHUB_TOKEN       used by the gh CLI to open the pull request
  APP_VERSION        demo app markup version (1 or 2)
`;

function loadDotEnv(): void {
  const file = path.join(process.cwd(), '.env');
  if (!existsSync(file)) return;
  try {
    // Node >= 20.12 only; silently ignored elsewhere (export variables instead).
    (process as { loadEnvFile?: (p: string) => void }).loadEnvFile?.(file);
  } catch {
    /* .env is optional */
  }
}

function number(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number, got "${value}"`);
  return parsed;
}

async function main(): Promise<number> {
  loadDotEnv();
  const { values } = parseArgs({
    options: {
      provider: { type: 'string', default: 'anthropic' },
      'dry-run': { type: 'boolean', default: false },
      'max-heals': { type: 'string' },
      'min-confidence': { type: 'string' },
      files: { type: 'string', multiple: true },
      'max-rounds': { type: 'string' },
      out: { type: 'string', default: 'heal-output' },
      'base-url': { type: 'string' },
      config: { type: 'string' },
      'mock-answers': { type: 'string' },
      effort: { type: 'string' },
      'no-pr': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const providerName = values.provider;
  if (providerName !== 'anthropic' && providerName !== 'mock') {
    throw new Error(`--provider must be "anthropic" or "mock", got "${providerName}"`);
  }
  const effort = values.effort;
  if (effort !== undefined && !['low', 'medium', 'high'].includes(effort)) {
    throw new Error(`--effort must be low, medium or high, got "${effort}"`);
  }

  const log = createLogger({ verbose: values.verbose });
  const provider = createProvider(providerName as ProviderName, {
    ...(values['mock-answers'] ? { mockAnswersPath: path.resolve(values['mock-answers']) } : {}),
    ...(effort ? { effort: effort as Effort } : {}),
  });
  const files = (values.files ?? []).flatMap((entry) => entry.split(',')).map((f) => f.trim()).filter(Boolean);

  await warnOnDemoVersionMismatch(values['base-url'], log);

  const report = await heal({
    provider,
    files,
    outDir: values.out,
    dryRun: values['dry-run'],
    maxHeals: number(values['max-heals'], '--max-heals', 5),
    minConfidence: number(values['min-confidence'], '--min-confidence', 0.7),
    maxRounds: number(values['max-rounds'], '--max-rounds', 5),
    openPr: !values['no-pr'],
    log,
    ...(values['base-url'] ? { baseUrl: values['base-url'] } : {}),
    ...(values.config ? { configPath: values.config } : {}),
  });

  if (report.diff) {
    log.info('');
    log.info(colors.bold(report.dryRun ? 'Diff (dry run, not applied):' : 'Diff:'));
    log.info(report.diff);
  }
  if (report.pr?.status === 'opened') log.success(`Pull request: ${report.pr.url}`);
  if (report.pr?.status === 'written') log.warn(`No pull request: ${report.pr.reason}. Body saved to ${report.pr.path}`);
  return 0;
}

/** Demo-app convenience: warn when a server with another APP_VERSION is already running. */
async function warnOnDemoVersionMismatch(baseUrl: string | undefined, log: ReturnType<typeof createLogger>): Promise<void> {
  const wanted = process.env.APP_VERSION;
  if (!wanted) return;
  try {
    const response = await fetch(`${baseUrl ?? `http://localhost:${process.env.PORT ?? '4173'}`}/healthz`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return;
    const body = (await response.json()) as { version?: string };
    if (body.version && body.version !== wanted) {
      log.warn(`A demo app with APP_VERSION=${body.version} is already running, but APP_VERSION=${wanted} was requested. Stop it first.`);
    }
  } catch {
    /* nothing running: the healer starts the app itself */
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`${colors.red('✗')} ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
