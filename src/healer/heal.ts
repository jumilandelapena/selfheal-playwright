/**
 * The orchestrator: run → classify → capture → ask → verify → patch → re-run → PR.
 *
 * Heals happen in rounds. A patched test must go green in the next run before
 * its heal counts; if it fails again at the same line, or with a non-locator
 * error, every patch of that test is reverted. If it fails further down on
 * another broken locator, the next round heals that one too.
 */
import { createTwoFilesPatch } from 'diff';
import fg from 'fast-glob';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureAppServer } from './app-server.js';
import { capturePage, type PageCapture } from './capture.js';
import { loadPlaywrightConfig } from './config.js';
import { validateCandidate } from './locator-expression.js';
import { createLogger, type Logger } from './log.js';
import { patchLocator, revertPatch, type PatchResult } from './patcher.js';
import { openPullRequest } from './pr.js';
import type { HealProvider, SuggestionRequest } from './providers/types.js';
import { BrowserSession, replaySteps } from './replay.js';
import { estimateCostUsd, writeReports } from './report.js';
import { runPlaywright } from './runner.js';
import { describeStep, parseTestSteps } from './steps.js';
import type {
  ActionStep,
  Candidate,
  CandidateResult,
  ExpectStep,
  HealRecord,
  HealReport,
  TestFailure,
  TestOutcome,
  TokenUsage,
} from './types.js';
import { verifyCandidate } from './verifier.js';

export interface HealOptions {
  provider: HealProvider;
  /** Project root. Defaults to the current working directory. */
  cwd?: string;
  /** Globs (relative to cwd) of the spec files the agent may touch. */
  files?: string[];
  /** Where reports, screenshots and run logs go. Default `heal-output`. */
  outDir?: string;
  /** Patch, verify and print the diff, then restore every file. No commit, no PR. */
  dryRun?: boolean;
  /** Maximum number of locator patches per run. Default 5. */
  maxHeals?: number;
  /** Candidates below this confidence are not even tried. Default 0.7. */
  minConfidence?: number;
  /** Maximum number of run → heal rounds. Default 5. */
  maxRounds?: number;
  baseUrl?: string;
  configPath?: string;
  /** Open a pull request when something was healed (ignored on dry runs). Default true. */
  openPr?: boolean;
  log?: Logger;
  /** Extra environment for Playwright and the app server, e.g. APP_VERSION. */
  env?: NodeJS.ProcessEnv;
  /** Timeout for replayed actions and assertions. Default 3000 ms. */
  actionTimeout?: number;
  /** Test hook passed through to the PR step. */
  ghAvailable?: boolean;
}

interface PendingTest {
  file: string;
  lastLine: number;
  patches: PatchResult[];
  healIds: string[];
}

const DEFAULTS = { maxHeals: 5, minConfidence: 0.7, maxRounds: 5, actionTimeout: 3_000, outDir: 'heal-output' } as const;

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? text;
}

/** The message without the source code frame Playwright appends. */
export function errorExcerpt(message: string, maxLines = 14): string {
  const lines = message.replace(/\r\n/g, '\n').split('\n');
  const frame = lines.findIndex((line) => /^\s*>?\s*\d+\s\|/.test(line));
  const kept = (frame === -1 ? lines : lines.slice(0, frame)).slice(0, maxLines);
  return kept.join('\n').trim().slice(0, 1_500);
}

function renderArgs(args: unknown[]): string {
  return args
    .map((arg) => (arg instanceof RegExp ? String(arg) : JSON.stringify(arg)))
    .join(', ');
}

export async function heal(options: HealOptions): Promise<HealReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const log = options.log ?? createLogger();
  const outDir = path.resolve(cwd, options.outDir ?? DEFAULTS.outDir);
  const dryRun = options.dryRun ?? false;
  const openPr = options.openPr ?? true;
  const maxHeals = options.maxHeals ?? DEFAULTS.maxHeals;
  const minConfidence = options.minConfidence ?? DEFAULTS.minConfidence;
  const maxRounds = options.maxRounds ?? DEFAULTS.maxRounds;
  const timeout = options.actionTimeout ?? DEFAULTS.actionTimeout;
  const env = { ...options.env };
  const provider = options.provider;
  const startedAt = new Date();

  await mkdir(path.join(outDir, 'screenshots'), { recursive: true });
  await mkdir(path.join(outDir, 'runs'), { recursive: true });

  const config = await loadPlaywrightConfig(cwd, options.configPath);
  const baseUrl = options.baseUrl ?? config.baseURL;
  if (!baseUrl) throw new Error('No base URL: set use.baseURL in the Playwright config or pass --base-url');

  const patterns = options.files?.length
    ? options.files
    : [`${path.relative(cwd, config.testDir).replace(/\\/g, '/') || '.'}/**/*.@(spec|test).@(ts|mts|js|mjs)`];
  const files = (await fg(patterns, { cwd, absolute: true, onlyFiles: true })).map((f) => path.normalize(f)).sort();
  if (files.length === 0) throw new Error(`No test files match ${patterns.join(', ')}`);

  log.step(
    `Healing ${files.length} spec file(s) with the ${provider.name} provider` +
      `${provider.model ? ` (${provider.model})` : ''}${dryRun ? ' — dry run' : ''}`,
  );

  const server = await ensureAppServer({ cwd, baseUrl, env, log, ...(config.webServer ? { webServer: config.webServer } : {}) });
  const browser = await BrowserSession.launch();

  const originals = new Map<string, string>();
  const heals: HealRecord[] = [];
  const tests = new Map<string, TestOutcome>();
  const pending = new Map<string, PendingTest>();
  const suggestionCache = new Map<string, { candidates: Candidate[]; note?: string }>();
  const seenFailures = new Set<string>();
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let budget = maxHeals;
  let rounds = 0;
  let testsRun = 0;
  let failures = 0;
  let healableFailures = 0;

  const outcome = (failure: TestFailure, status: TestOutcome['status'], detail: string, healIds: string[] = []): void => {
    tests.set(failure.id, { testId: failure.id, title: failure.title, relFile: failure.relFile, status, detail, heals: healIds });
  };

  const revertTest = (testId: string, state: PendingTest, detail: string): void => {
    for (const patch of [...state.patches].reverse()) {
      try {
        revertPatch(patch);
      } catch (error) {
        log.error(`could not revert ${patch.filePath}:${patch.line}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const record of heals) {
      if (state.healIds.includes(record.id)) {
        record.status = 'reverted';
        record.statusDetail = detail;
      }
    }
    const [relFile = '', title = ''] = testId.split('::');
    tests.set(testId, { testId, title, relFile, status: 'unhealed', detail, heals: state.healIds });
    pending.delete(testId);
    log.warn(`reverted ${testId}: ${detail}`);
  };

  const giveUp = (failure: TestFailure, detail: string): void => {
    const state = pending.get(failure.id);
    if (state) revertTest(failure.id, state, detail);
    else outcome(failure, 'unhealed', detail);
  };

  /** Capture → ask → verify → patch for one failure. */
  const healOne = async (failure: TestFailure, round: number): Promise<{ record: HealRecord; patch?: PatchResult }> => {
    const id = `heal-${String(heals.length + 1).padStart(3, '0')}`;
    const record: HealRecord = {
      id,
      round,
      testId: failure.id,
      testTitle: failure.title,
      file: failure.file,
      relFile: failure.relFile,
      line: failure.line,
      intent: failure.title,
      action: '?',
      oldLocator: failure.classification.locator ?? '?',
      ...(failure.classification.locator ? { errorLocator: failure.classification.locator } : {}),
      failureKind: failure.classification.kind,
      errorExcerpt: errorExcerpt(failure.message),
      candidates: [],
      status: 'skipped',
      statusDetail: '',
    };
    const skip = (detail: string): { record: HealRecord } => {
      record.status = 'skipped';
      record.statusDetail = detail;
      log.warn(`${id} skipped: ${detail}`);
      return { record };
    };

    if (path.resolve(failure.errorFile) !== path.resolve(failure.file)) {
      const where = path.relative(cwd, failure.errorFile).replace(/\\/g, '/');
      return skip(
        `the failure happened inside ${where}:${failure.line}, not in the test body; ` +
          'locators that live in helpers or page objects cannot be healed yet',
      );
    }

    let steps;
    try {
      steps = parseTestSteps(readFileSync(failure.file, 'utf8'), failure.file, failure.title, failure.specLine).steps;
    } catch (error) {
      return skip(`cannot parse the test: ${error instanceof Error ? error.message : String(error)}`);
    }
    const index = steps.findIndex((step) => step.startLine <= failure.line && failure.line <= step.endLine);
    const step = steps[index];
    if (!step || (step.kind !== 'action' && step.kind !== 'expect') || !step.locator) {
      return skip(`line ${failure.line} is not a supported locator action or assertion`);
    }
    const before = steps.slice(0, index);
    const blocker = before.find((s) => s.kind === 'unsupported');
    if (blocker) return skip(`cannot replay line ${blocker.startLine} (${blocker.reason})`);

    const locatorStep: ActionStep | ExpectStep = step;
    record.intent = locatorStep.stepTitle ?? failure.title;
    if (locatorStep.stepTitle) record.stepTitle = locatorStep.stepTitle;
    record.action = describeStep(locatorStep);
    record.oldLocator = locatorStep.locator ?? record.oldLocator;
    log.step(`${id} ${failure.relFile}:${failure.line} ${record.action} ${record.oldLocator}`);

    // 1. Replay the passing steps and capture the page.
    let capture: PageCapture;
    {
      const { context, page } = await browser.newPage(baseUrl);
      try {
        await replaySteps(page, before, timeout);
        capture = await capturePage(page);
      } catch (error) {
        return skip(`replaying the steps before the failure failed: ${firstLine(error instanceof Error ? error.message : String(error))}`);
      } finally {
        await context.close();
      }
    }
    record.pageUrl = capture.url;
    record.screenshot = `screenshots/${id}-before.png`;
    await writeFile(path.join(outDir, record.screenshot), capture.screenshotPng);

    // 2. Ask the provider (cached per page + locator + action within a run).
    const cacheKey = `${capture.url}|${record.oldLocator}|${record.action}`;
    let suggestion = suggestionCache.get(cacheKey);
    if (!suggestion) {
      const request: SuggestionRequest = {
        testTitle: failure.title,
        ...(locatorStep.stepTitle ? { stepTitle: locatorStep.stepTitle } : {}),
        relFile: failure.relFile,
        line: failure.line,
        statement: locatorStep.text,
        oldLocator: record.oldLocator,
        action: record.action,
        actionArgs: renderArgs(locatorStep.args),
        failureKind: failure.classification.kind,
        failureReason: failure.classification.reason,
        errorExcerpt: record.errorExcerpt,
        page: { url: capture.url, title: capture.title, aria: capture.aria, dom: capture.dom, screenshotPng: capture.screenshotPng },
      };
      try {
        const response = await provider.suggest(request);
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;
        record.usage = response.usage;
        suggestion = { candidates: response.candidates, ...(response.note ? { note: response.note } : {}) };
        suggestionCache.set(cacheKey, suggestion);
      } catch (error) {
        record.status = 'no-candidate';
        record.statusDetail = `provider error: ${firstLine(error instanceof Error ? error.message : String(error))}`;
        log.error(`${id} ${record.statusDetail}`);
        return { record };
      }
    } else {
      log.debug(`${id} reusing the suggestion for ${record.oldLocator}`);
    }
    if (suggestion.candidates.length === 0) {
      record.status = 'no-candidate';
      record.statusDetail = suggestion.note ?? 'the provider returned no candidates';
      log.warn(`${id} ${record.statusDetail}`);
      return { record };
    }

    // 3. Verify candidates on a freshly replayed page, best confidence first.
    let chosen: CandidateResult | undefined;
    for (const candidate of suggestion.candidates) {
      if (candidate.confidence < minConfidence) {
        record.candidates.push({ ...candidate, status: 'skipped', detail: `confidence ${candidate.confidence.toFixed(2)} is below the minimum ${minConfidence}` });
        continue;
      }
      const validation = validateCandidate(candidate.locator);
      if (!validation.ok) {
        record.candidates.push({ ...candidate, status: 'rejected', detail: validation.reason });
        continue;
      }
      const { context, page } = await browser.newPage(baseUrl);
      try {
        await replaySteps(page, before, timeout);
        const result = await verifyCandidate(page, candidate, locatorStep, { timeout });
        record.candidates.push(result);
        if (result.status === 'passed') {
          chosen = result;
          break;
        }
        log.debug(`${id} rejected ${candidate.locator}: ${result.detail}`);
      } catch (error) {
        record.candidates.push({ ...candidate, status: 'rejected', detail: `replay failed: ${firstLine(error instanceof Error ? error.message : String(error))}` });
      } finally {
        await context.close();
      }
    }
    if (!chosen) {
      record.status = 'unverified';
      record.statusDetail = 'no candidate passed verification';
      log.warn(`${id} ${record.statusDetail}`);
      return { record };
    }

    // 4. Patch the test file.
    if (!originals.has(failure.file)) originals.set(failure.file, readFileSync(failure.file, 'utf8'));
    let patch: PatchResult;
    try {
      patch = patchLocator({ filePath: failure.file, line: failure.line, oldLocator: record.oldLocator, newLocator: chosen.locator });
    } catch (error) {
      return skip(`patch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    record.newLocator = patch.newLocator;
    record.confidence = chosen.confidence;
    record.kind = chosen.kind;
    record.reason = chosen.reason;
    record.status = 'pending';
    record.statusDetail = 'patched, waiting for a green run';
    log.success(`${id} ${record.oldLocator} → ${record.newLocator} (confidence ${chosen.confidence.toFixed(2)})`);
    return { record, patch };
  };

  try {
    let filesToRun = files;
    for (let round = 1; ; round++) {
      rounds = round;
      log.step(`Round ${round}: running ${filesToRun.length} spec file(s)`);
      const run = await runPlaywright({
        cwd,
        files: filesToRun,
        outputFile: path.join(outDir, 'runs', `round-${round}.json`),
        configPath: config.configPath,
        env,
      });
      if (round === 1) testsRun = run.total;
      log.info(`  ${run.passed.length} passed, ${run.failed.length} failed`);

      // Settle the tests patched in the previous round.
      for (const [testId, state] of [...pending]) {
        const failure = run.failed.find((f) => f.id === testId);
        if (!failure) {
          if (!run.passed.includes(testId)) continue;
          for (const record of heals) {
            if (state.healIds.includes(record.id)) {
              record.status = 'healed';
              record.statusDetail = 'the test passed after the patch';
            }
          }
          const [relFile = '', title = ''] = testId.split('::');
          tests.set(testId, { testId, title, relFile, status: 'healed', detail: `${state.healIds.length} locator(s) healed`, heals: state.healIds });
          pending.delete(testId);
          log.success(`${testId} is green`);
          continue;
        }
        if (failure.classification.healable && failure.line > state.lastLine) {
          log.info(`  ${testId} got further, now failing at line ${failure.line}`);
          continue;
        }
        revertTest(
          testId,
          state,
          failure.classification.healable
            ? `still failing at line ${failure.line} after the patch`
            : `now fails with a non-locator error (${failure.classification.reason})`,
        );
      }

      // Collect what is left to heal.
      const todo: TestFailure[] = [];
      for (const failure of run.failed) {
        const key = `${failure.id}@${failure.line}`;
        if (!seenFailures.has(key)) {
          seenFailures.add(key);
          failures++;
          if (failure.classification.healable) healableFailures++;
        }
        if (tests.has(failure.id)) continue;
        if (!failure.classification.healable) {
          outcome(failure, 'skipped', `${failure.classification.kind}: ${failure.classification.reason}`);
          log.warn(`skip ${failure.id}: ${failure.classification.reason}`);
          continue;
        }
        todo.push(failure);
      }
      if (todo.length === 0) break;
      if (round > maxRounds) {
        for (const failure of todo) giveUp(failure, `max rounds (${maxRounds}) reached`);
        break;
      }

      let patchedAny = false;
      for (const failure of todo) {
        if (budget <= 0) {
          giveUp(failure, `max heals (${maxHeals}) reached`);
          continue;
        }
        const { record, patch } = await healOne(failure, round);
        heals.push(record);
        if (record.status === 'pending' && patch) {
          budget--;
          patchedAny = true;
          const state = pending.get(failure.id) ?? { file: failure.file, lastLine: failure.line, patches: [], healIds: [] };
          state.lastLine = failure.line;
          state.patches.push(patch);
          state.healIds.push(record.id);
          pending.set(failure.id, state);
        } else {
          giveUp(failure, record.statusDetail);
        }
      }
      if (!patchedAny) break;
      filesToRun = [...new Set([...pending.values()].map((state) => state.file))];
    }
    for (const [testId, state] of [...pending]) revertTest(testId, state, 'the patched test did not run again');
  } finally {
    await browser.close();
    await server.stop();
  }

  // Diff of what is left in the working tree.
  const changedFiles: string[] = [];
  let diff = '';
  for (const [file, original] of originals) {
    const current = readFileSync(file, 'utf8');
    if (current === original) continue;
    changedFiles.push(file);
    const rel = path.relative(cwd, file).replace(/\\/g, '/');
    diff += createTwoFilesPatch(`a/${rel}`, `b/${rel}`, original, current, '', '', { context: 3 });
  }
  if (dryRun) {
    for (const [file, original] of originals) writeFileSync(file, original, 'utf8');
    if (changedFiles.length > 0) log.info('Dry run: the patched files were restored');
  }

  const healedRecords = heals.filter((h) => h.status === 'healed');
  const finishedAt = new Date();
  const report: HealReport = {
    schemaVersion: 1,
    tool: 'selfheal-playwright',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    provider: provider.name,
    ...(provider.model ? { model: provider.model } : {}),
    dryRun,
    ...(env.APP_VERSION ?? process.env.APP_VERSION ? { appVersion: env.APP_VERSION ?? process.env.APP_VERSION } : {}),
    baseUrl,
    options: { maxHeals, minConfidence, maxRounds, files: patterns },
    rounds,
    summary: {
      testsRun,
      failures,
      healableFailures,
      healedLocators: healedRecords.length,
      healedTests: [...tests.values()].filter((t) => t.status === 'healed').length,
      revertedLocators: heals.filter((h) => h.status === 'reverted').length,
      unhealedTests: [...tests.values()].filter((t) => t.status === 'unhealed').length,
      skippedFailures: [...tests.values()].filter((t) => t.status === 'skipped').length,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCostUsd: provider.name === 'anthropic' ? estimateCostUsd(usage) : 0,
    },
    heals,
    tests: [...tests.values()],
    diff,
  };

  if (dryRun) report.pr = { status: 'skipped', reason: 'dry run' };
  else if (!openPr) report.pr = { status: 'skipped', reason: 'pull request disabled with --no-pr' };
  // Write once so the PR step can ship the report files, then again with the PR outcome.
  const paths = await writeReports(report, outDir);
  if (!report.pr) {
    report.pr = await openPullRequest({
      cwd,
      report,
      patchedFiles: changedFiles,
      outDir,
      log,
      env,
      ...(options.ghAvailable !== undefined ? { ghAvailable: options.ghAvailable } : {}),
    });
    await writeReports(report, outDir);
  }

  log.info('');
  log.info(
    `Done in ${(report.durationMs / 1000).toFixed(1)}s: ${report.summary.healedLocators} locator(s) healed in ` +
      `${report.summary.healedTests} test(s), ${report.summary.revertedLocators} reverted, ` +
      `${report.summary.unhealedTests + report.summary.skippedFailures} left for humans.`,
  );
  log.info(`Report: ${path.relative(cwd, paths.htmlPath)}`);
  return report;
}
