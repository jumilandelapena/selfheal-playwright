import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { classifyFailure, stripAnsi } from './classifier.js';
import type { RunResult, TestFailure } from './types.js';

export interface RunOptions {
  cwd: string;
  /** Absolute paths of the spec files to run. */
  files: string[];
  /** Where the JSON report is written. */
  outputFile: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}

/* Minimal shape of Playwright's JSON reporter output. */
interface JsonLocation {
  file: string;
  line: number;
  column: number;
}
interface JsonError {
  message?: string;
  location?: JsonLocation;
}
interface JsonResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  error?: JsonError;
  errors?: JsonError[];
}
interface JsonTest {
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  results: JsonResult[];
}
interface JsonSpec {
  title: string;
  file: string;
  line: number;
  tests: JsonTest[];
}
interface JsonSuite {
  title: string;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}
export interface JsonReport {
  config?: { rootDir?: string };
  suites: JsonSuite[];
}

/** Resolve the Playwright CLI entry so no shell (or npx) is needed. */
function playwrightCli(cwd: string): string {
  const require = createRequire(path.join(cwd, 'package.json'));
  return require.resolve('@playwright/test/cli');
}

export function testId(relFile: string, title: string): string {
  return `${relFile.replace(/\\/g, '/')}::${title}`;
}

/** Run Playwright with the JSON reporter and collect classified failures. */
export async function runPlaywright(options: RunOptions): Promise<RunResult> {
  const { cwd, files, outputFile } = options;
  await mkdir(path.dirname(outputFile), { recursive: true });
  await rm(outputFile, { force: true });

  const args = [playwrightCli(cwd), 'test', '--reporter=json', '--retries=0'];
  if (options.configPath) args.push('--config', options.configPath);
  // Playwright treats positional arguments as path filters; forward slashes
  // work on every platform.
  for (const file of files) args.push(path.relative(cwd, file).replace(/\\/g, '/'));

  const stderr: string[] = [];
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...options.env, PLAYWRIGHT_JSON_OUTPUT_NAME: outputFile, FORCE_COLOR: '0' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  let raw: string;
  try {
    raw = await readFile(outputFile, 'utf8');
  } catch {
    throw new Error(
      `Playwright exited with code ${exitCode} and wrote no JSON report.\n${stderr.join('').slice(-2000)}`,
    );
  }
  return parseJsonReport(JSON.parse(raw) as JsonReport, cwd, outputFile);
}

export function parseJsonReport(report: JsonReport, cwd: string, reportPath: string): RunResult {
  const rootDir = report.config?.rootDir ?? cwd;
  const passed: string[] = [];
  const failed: TestFailure[] = [];
  let total = 0;

  const visit = (suite: JsonSuite, titles: string[]): void => {
    for (const spec of suite.specs ?? []) {
      const absFile = path.resolve(rootDir, spec.file);
      const relFile = path.relative(cwd, absFile).replace(/\\/g, '/');
      const id = testId(relFile, spec.title);
      for (const test of spec.tests) {
        total++;
        const result = test.results[test.results.length - 1];
        if (!result) continue;
        if (result.status === 'passed' || test.status === 'expected') {
          passed.push(id);
          continue;
        }
        if (result.status === 'skipped' || test.status === 'skipped') continue;
        const error = result.errors?.[0] ?? result.error;
        const message = stripAnsi(error?.message ?? 'unknown error');
        const location = error?.location ?? parseStackLocation(message, absFile);
        failed.push({
          id,
          file: absFile,
          relFile,
          title: spec.title,
          titlePath: [...titles, spec.title],
          specLine: spec.line,
          line: location?.line ?? spec.line,
          column: location?.column ?? 0,
          message,
          classification: classifyFailure(message),
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, child.title ? [...titles, child.title] : titles);
  };
  for (const suite of report.suites) visit(suite, []);
  return { passed, failed, total, reportPath };
}

/** Fallback when the reporter gives no location: read it from the stack. */
function parseStackLocation(message: string, file: string): JsonLocation | undefined {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}:(\\d+):(\\d+)`).exec(message);
  if (!match) return undefined;
  return { file, line: Number(match[1]), column: Number(match[2]) };
}
