import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../../src/healer/log.js';
import { healBranchName, openPullRequest, prTitle } from '../../src/healer/pr.js';
import { estimateCostUsd, renderHtml, renderMarkdown } from '../../src/healer/report.js';
import type { HealReport } from '../../src/healer/types.js';

function sampleReport(healed = 1): HealReport {
  return {
    schemaVersion: 1,
    tool: 'selfheal-playwright',
    startedAt: '2026-10-17T10:00:00.000Z',
    finishedAt: '2026-10-17T10:00:30.000Z',
    durationMs: 30_000,
    provider: 'mock',
    dryRun: false,
    baseUrl: 'http://localhost:4173',
    options: { maxHeals: 5, minConfidence: 0.7, maxRounds: 5, files: ['tests/**/*.spec.ts'] },
    rounds: 2,
    summary: {
      testsRun: 12,
      failures: 1,
      healableFailures: 1,
      healedLocators: healed,
      healedTests: healed,
      revertedLocators: 0,
      unhealedTests: 1,
      skippedFailures: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    },
    heals: [
      {
        id: 'heal-001',
        round: 1,
        testId: 'tests/login.spec.ts::shows an error',
        testTitle: 'shows an error',
        file: '/repo/tests/login.spec.ts',
        relFile: 'tests/login.spec.ts',
        line: 11,
        intent: 'shows an error',
        action: 'click',
        oldLocator: "page.locator('#login-btn')",
        failureKind: 'locator-timeout',
        errorExcerpt: 'TimeoutError: locator.click: Timeout 3000ms exceeded.',
        candidates: [
          { locator: "page.locator('a | b')", kind: 'css', confidence: 0.8, reason: 'r', status: 'rejected', detail: 'matches 2 elements' },
          { locator: "page.getByRole('button', { name: 'Sign in' })", kind: 'role', confidence: 0.95, reason: 'renamed | button', status: 'passed', detail: 'ok' },
        ],
        newLocator: "page.getByRole('button', { name: 'Sign in' })",
        confidence: 0.95,
        kind: 'role',
        reason: 'renamed | button',
        status: healed ? 'healed' : 'unverified',
        statusDetail: 'the test passed after the patch',
      },
    ],
    tests: [
      { testId: 'tests/login.spec.ts::shows an error', title: 'shows an error', relFile: 'tests/login.spec.ts', status: healed ? 'healed' : 'unhealed', detail: '1 locator(s) healed', heals: ['heal-001'] },
      { testId: 'tests/todos.spec.ts::counts', title: 'counts', relFile: 'tests/todos.spec.ts', status: 'unhealed', detail: 'no candidate passed verification', heals: [] },
    ],
    diff: '--- a/tests/login.spec.ts\n+++ b/tests/login.spec.ts\n',
  };
}

describe('renderMarkdown', () => {
  it('lists healed locators in a table and escapes pipes', () => {
    const md = renderMarkdown(sampleReport(), { title: 'fix(tests): self-heal 1 locator' });
    expect(md).toContain('# fix(tests): self-heal 1 locator');
    expect(md).toContain("| tests/login.spec.ts › shows an error (L11) | `page.locator('#login-btn')` | `page.getByRole('button', { name: 'Sign in' })` | 0.95 | renamed \\| button |");
    expect(md).toContain('## Not healed');
    expect(md).toContain('tests/todos.spec.ts › counts | unhealed | no candidate passed verification');
    expect(md).toContain("`page.locator('a \\| b')` | rejected: matches 2 elements");
  });

  it('embeds screenshots when a URL resolver is given', () => {
    const md = renderMarkdown({ ...sampleReport(), heals: [{ ...sampleReport().heals[0]!, screenshot: 'screenshots/heal-001-before.png' }] }, {
      screenshotUrl: (heal) => `https://example.test/${heal.screenshot}`,
    });
    expect(md).toContain('![shows an error before the heal](https://example.test/screenshots/heal-001-before.png)');
  });
});

describe('renderHtml', () => {
  it('produces a self-contained page with the summary and the diff', () => {
    const html = renderHtml(sampleReport(), tmpdir());
    expect(html).toContain('<b>12</b><span>tests run</span>');
    expect(html).toContain('page.getByRole(&#39;button&#39;, { name: &#39;Sign in&#39; })');
    expect(html).toContain('+++ b/tests/login.spec.ts');
    expect(html).not.toContain('<script');
  });
});

describe('estimateCostUsd', () => {
  it('uses the published claude-opus-5-5 prices', () => {
    expect(estimateCostUsd({ inputTokens: 10_000, outputTokens: 500 })).toBe(0.05);
    expect(estimateCostUsd({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});

describe('openPullRequest', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('names the branch and title from the report', () => {
    expect(prTitle(sampleReport(3))).toBe('fix(tests): self-heal 3 locators');
    expect(prTitle(sampleReport(1))).toBe('fix(tests): self-heal 1 locator');
    expect(healBranchName(new Date('2026-10-17T12:00:00Z'), 'abc1234')).toBe('heal/2026-10-17-abc1234');
  });

  it('skips when nothing was healed', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'selfheal-pr-'));
    const result = await openPullRequest({ cwd: dir, report: sampleReport(0), patchedFiles: [], outDir: dir, log: silentLogger });
    expect(result).toEqual({ status: 'skipped', reason: 'nothing was healed' });
  });

  it('writes heal-pr.md when the directory is not a git repository', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'selfheal-pr-'));
    const result = await openPullRequest({ cwd: dir, report: sampleReport(), patchedFiles: [], outDir: dir, log: silentLogger });
    expect(result).toMatchObject({ status: 'written', reason: 'not a git repository' });
    const body = readFileSync(path.join(dir, 'heal-pr.md'), 'utf8');
    expect(body).toContain('# fix(tests): self-heal 1 locator');
  });

  it('writes heal-pr.md when gh is missing, without creating a branch', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'selfheal-pr-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    const result = await openPullRequest({
      cwd: dir,
      report: sampleReport(),
      patchedFiles: [path.join(dir, 'a.txt')],
      outDir: dir,
      log: silentLogger,
      ghAvailable: false,
    });
    expect(result).toMatchObject({ status: 'written', reason: 'the gh CLI is not installed' });
    expect(existsSync(path.join(dir, 'heal-pr.md'))).toBe(true);
    const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    expect(branch).toBe('main');
  });
});
