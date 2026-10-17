/**
 * Open a pull request with the healed test files through the GitHub CLI.
 *
 * Safety rules: always a fresh `heal/<date>-<sha>` branch, never main, never
 * merge. When `gh` or a token is missing the PR body is written to
 * `heal-pr.md` instead so nothing is lost.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commandExists, git, run, tryRun } from './git.js';
import type { Logger } from './log.js';
import { renderMarkdown } from './report.js';
import type { HealReport, PullRequestOutcome } from './types.js';

export const PR_LABEL = 'self-heal';
export const FALLBACK_FILE = 'heal-pr.md';
const PROTECTED_BRANCHES = new Set(['main', 'master']);

export interface PullRequestOptions {
  cwd: string;
  report: HealReport;
  /** Absolute paths of the test files that were patched. */
  patchedFiles: string[];
  /** Directory holding heal-report.json/html and screenshots. */
  outDir: string;
  log: Logger;
  env?: NodeJS.ProcessEnv;
  /** Test hook: pretend `gh` is (un)available. */
  ghAvailable?: boolean;
}

export function prTitle(report: HealReport): string {
  const n = report.summary.healedLocators;
  return `fix(tests): self-heal ${n} locator${n === 1 ? '' : 's'}`;
}

export function healBranchName(date: Date, sha: string): string {
  return `heal/${date.toISOString().slice(0, 10)}-${sha}`;
}

function writeFallback(options: PullRequestOptions, reason: string): PullRequestOutcome {
  const target = path.join(options.cwd, FALLBACK_FILE);
  const relOut = path.relative(options.cwd, options.outDir).replace(/\\/g, '/');
  const body = renderMarkdown(options.report, {
    title: prTitle(options.report),
    screenshotUrl: (record) => (record.screenshot ? `${relOut}/${record.screenshot}` : undefined),
  });
  writeFileSync(target, body, 'utf8');
  options.log.warn(`${reason}. PR body written to ${FALLBACK_FILE}`);
  return { status: 'written', path: target, reason };
}

export async function openPullRequest(options: PullRequestOptions): Promise<PullRequestOutcome> {
  const { cwd, report, log } = options;
  const env = { ...process.env, ...options.env };
  if (report.summary.healedLocators === 0) return { status: 'skipped', reason: 'nothing was healed' };

  if (!git.isRepo(cwd)) return writeFallback(options, 'not a git repository');
  const ghAvailable = options.ghAvailable ?? commandExists('gh', cwd);
  if (!ghAvailable) return writeFallback(options, 'the gh CLI is not installed');
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  const authenticated = Boolean(token) || tryRun('gh', ['auth', 'status'], cwd, env) !== undefined;
  if (!authenticated) return writeFallback(options, 'GITHUB_TOKEN is not set and gh is not logged in');

  const baseBranch = env.GITHUB_REF_NAME ?? git.currentBranch(cwd) ?? 'main';
  const sha = git.shortSha(cwd);
  const branch = healBranchName(new Date(), sha);
  if (PROTECTED_BRANCHES.has(branch) || branch === baseBranch) {
    throw new Error(`refusing to use branch ${branch}`);
  }

  // Keep the report next to the code change so reviewers can open it from the PR.
  const healDir = `docs/heals/${branch.slice('heal/'.length)}`;
  const absHealDir = path.join(cwd, healDir);
  mkdirSync(absHealDir, { recursive: true });
  for (const name of ['heal-report.json', 'heal-report.html']) {
    const source = path.join(options.outDir, name);
    if (existsSync(source)) copyFileSync(source, path.join(absHealDir, name));
  }
  const screenshots = new Map<string, string>();
  for (const record of report.heals) {
    if (record.status !== 'healed' || !record.screenshot) continue;
    const source = path.join(options.outDir, record.screenshot);
    if (!existsSync(source)) continue;
    const name = path.basename(record.screenshot);
    copyFileSync(source, path.join(absHealDir, name));
    screenshots.set(record.id, `${healDir}/${name}`);
  }

  const repo = tryRun('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], cwd, env);
  const body = renderMarkdown(report, {
    title: prTitle(report),
    reportLink: `${healDir}/heal-report.html`,
    screenshotUrl: (record) => {
      const file = screenshots.get(record.id);
      if (!file) return undefined;
      return repo ? `https://github.com/${repo}/blob/${branch}/${file}?raw=true` : file;
    },
  });
  const bodyFile = path.join(absHealDir, 'pr-body.md');
  writeFileSync(bodyFile, body, 'utf8');

  try {
    const identity = git.hasIdentity(cwd)
      ? []
      : ['-c', 'user.name=selfheal-playwright', '-c', 'user.email=selfheal-playwright@users.noreply.github.com'];
    log.step(`Creating branch ${branch} from ${baseBranch}`);
    run('git', ['checkout', '-b', branch], cwd, env);
    run('git', ['add', '--', ...options.patchedFiles.map((file) => path.relative(cwd, file)), healDir], cwd, env);
    run('git', [...identity, 'commit', '-m', prTitle(report), '-m', `Heal report: ${healDir}/heal-report.html`], cwd, env);
    run('git', ['push', '-u', 'origin', branch], cwd, env);

    tryRun(
      'gh',
      ['label', 'create', PR_LABEL, '--color', '7057ff', '--description', 'Opened by the self-healing test agent', '--force'],
      cwd,
      env,
    );
    log.step('Opening pull request');
    const url = run(
      'gh',
      ['pr', 'create', '--base', baseBranch, '--head', branch, '--title', prTitle(report), '--body-file', bodyFile, '--label', PR_LABEL],
      cwd,
      env,
    );
    log.success(`Pull request opened: ${url}`);
    return { status: 'opened', url, branch };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return writeFallback(options, `could not open the pull request (${message.split('\n')[0]})`);
  }
}
