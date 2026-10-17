/**
 * End-to-end with the mock provider: copy the project into a sandbox, serve
 * APP_VERSION=2, run `pnpm heal --provider mock`, and check that the test
 * files were patched and the suite is green afterwards.
 *
 * The sandbox shares node_modules through a symlink/junction so nothing has
 * to be installed, and the real repository is never modified.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPlaywright } from '../../src/healer/runner.js';
import type { HealReport } from '../../src/healer/types.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const PORT = '4177';

let sandbox: string;
let report: HealReport;
let stdout = '';

beforeAll(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'selfheal-e2e-'));
  for (const entry of ['tests', 'demo-app', 'playwright.config.ts', 'package.json', 'tsconfig.json']) {
    cpSync(path.join(repo, entry), path.join(sandbox, entry), { recursive: true });
  }
  symlinkSync(path.join(repo, 'node_modules'), path.join(sandbox, 'node_modules'), 'junction');

  const result = spawnSync(
    process.execPath,
    [require.resolve('tsx/cli'), path.join(repo, 'src', 'cli', 'heal.ts'), '--provider', 'mock', '--max-heals', '30', '--out', 'heal-output'],
    {
      cwd: sandbox,
      env: { ...process.env, APP_VERSION: '2', PORT, NO_COLOR: '1', CI: '' },
      encoding: 'utf8',
      timeout: 540_000,
    },
  );
  stdout = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0) throw new Error(`heal exited with ${result.status}\n${stdout.slice(-4000)}`);
  report = JSON.parse(readFileSync(path.join(sandbox, 'heal-output', 'heal-report.json'), 'utf8')) as HealReport;
});

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

describe('mock provider end to end (APP_VERSION=2)', () => {
  it('heals every broken test and leaves the two intact tests alone', () => {
    expect(report.summary.testsRun).toBe(12);
    expect(report.summary.healedTests).toBe(10);
    expect(report.summary.healedLocators).toBe(18);
    expect(report.summary.revertedLocators).toBe(0);
    expect(report.summary.unhealedTests).toBe(0);
    expect(report.tests.every((t) => t.status === 'healed')).toBe(true);
  });

  it('patches the spec files with verified locators only', () => {
    const login = readFileSync(path.join(sandbox, 'tests', 'login.spec.ts'), 'utf8');
    expect(login).not.toContain("locator('#login-btn')");
    expect(login).toContain("page.getByRole('button', { name: 'Sign in' }).click()");
    expect(login).toContain(".toHaveText('Invalid username or password')");

    const settings = readFileSync(path.join(sandbox, 'tests', 'settings.spec.ts'), 'utf8');
    expect(settings).toContain("page.getByRole('button', { name: 'Save changes' }).click()");
    expect(settings).toContain("expect(page.getByRole('status')).toHaveText('Settings saved')");

    // The deliberately bad mock candidate was rejected by the verifier.
    const strict = report.heals.find((h) => h.oldLocator === "page.locator('.btn')");
    expect(strict?.failureKind).toBe('strict-mode');
    expect(strict?.candidates[0]).toMatchObject({ locator: "page.locator('form .btn')", status: 'rejected' });
  });

  it('writes the reports and the PR body fallback (no git repo, no gh)', () => {
    expect(existsSync(path.join(sandbox, 'heal-output', 'heal-report.html'))).toBe(true);
    expect(report.pr).toMatchObject({ status: 'written', reason: 'not a git repository' });
    expect(readFileSync(path.join(sandbox, 'heal-pr.md'), 'utf8')).toContain('fix(tests): self-heal 18 locators');
    expect(stdout).toContain('18 locator(s) healed in 10 test(s)');
  });

  it('leaves the suite green against APP_VERSION=2', async () => {
    const run = await runPlaywright({
      cwd: sandbox,
      files: ['login', 'settings', 'todos'].map((name) => path.join(sandbox, 'tests', `${name}.spec.ts`)),
      outputFile: path.join(sandbox, 'heal-output', 'final.json'),
      env: { APP_VERSION: '2', PORT },
    });
    expect(run.failed).toEqual([]);
    expect(run.passed).toHaveLength(12);
  });
});
