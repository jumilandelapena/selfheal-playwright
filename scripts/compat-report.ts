/**
 * Compatibility report: how much of another Playwright suite could the healer
 * replay as it is written today?
 *
 *   pnpm compat <project root> [tests glob]
 *   pnpm compat ../my-app 'e2e/**\/*.spec.ts'
 *
 * It runs the healer's own step parser (src/healer/steps.ts) over every test
 * and reports, per folder and per reason, where replay would stop. Nothing is
 * executed and nothing is written. The suite is only read.
 *
 * How to read the numbers:
 * - "replayable prefix": the statements before a failing line are all
 *   supported and at least one of them is a page-rooted locator step, so a
 *   failure on that step could be captured, verified and patched.
 * - "fully replayable": every statement of the test is supported.
 * - A suite built on page objects or custom fixtures scores near 0% here; the
 *   healer then reports each failure as "cannot replay" instead of guessing.
 */
import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Node, Project, SyntaxKind } from 'ts-morph';
import { parseTestSteps } from '../src/healer/steps.js';
import type { Step } from '../src/healer/types.js';

const root = path.resolve(process.argv[2] ?? '.');
const pattern = process.argv[3] ?? '**/*.@(spec|test).@(ts|mts|js|mjs)';
const files = (
  await fg([pattern], {
    cwd: root,
    absolute: true,
    ignore: ['**/node_modules/**', '**/.claude/**', '**/test-results/**', '**/playwright-report/**', '**/dist/**'],
  })
).sort();

const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
const TEST_CALLEE = /^test(\.(only|skip|fixme|fail))?$/;

interface FolderRow {
  folder: string;
  tests: number;
  fully: number;
  prefix: number;
}

const folders = new Map<string, FolderRow>();
const reasons = new Map<string, number>();
const firstReasons = new Map<string, number>();
let tests = 0;
let fully = 0;
let prefix = 0;
let anyLocator = 0;
let parseErrors = 0;
let stepsTotal = 0;
let stepsSupported = 0;
const examples: string[] = [];

/** Collapse the long tail of reasons into a few readable buckets. */
function bucket(reason: string): string {
  return reason
    .replace(/unsupported argument: .*/, 'argument is a variable, template string or call')
    .replace(/(\w+)Statement is not a supported statement/, '$1Statement (variables, loops, if, try, return, ...)')
    .replace(/locator\.\w+\(\) is not a supported action/, 'locator.<action>() is not in the supported action list')
    .replace(/^statement is not a page\.goto.*/, 'call on a fixture, helper or page object (not rooted at `page`)')
    .slice(0, 90);
}

const hasLocator = (step: Step): boolean => (step.kind === 'action' || step.kind === 'expect') && Boolean(step.locator);

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const folderKey = rel.split('/').slice(0, -1).join('/') || '.';
  const row = folders.get(folderKey) ?? { folder: folderKey, tests: 0, fully: 0, prefix: 0 };
  folders.set(folderKey, row);

  const source = readFileSync(file, 'utf8');
  const sourceFile = project.createSourceFile(`__${rel.replace(/[^\w.]/g, '_')}`, source, { overwrite: true });
  const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const first = call.getArguments()[0];
    return (
      TEST_CALLEE.test(call.getExpression().getText().replace(/\s+/g, '')) &&
      first !== undefined &&
      (Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first))
    );
  });

  for (const call of calls) {
    const first = call.getArguments()[0];
    const title = Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first) ? first.getLiteralValue() : '';
    tests++;
    row.tests++;
    let steps: Step[];
    try {
      steps = parseTestSteps(source, file, title, call.getStartLineNumber()).steps;
    } catch (error) {
      parseErrors++;
      const key = `parse error: ${(error as Error).message.slice(0, 60)}`;
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
      continue;
    }
    stepsTotal += steps.length;
    stepsSupported += steps.filter((step) => step.kind !== 'unsupported').length;
    if (steps.some(hasLocator)) anyLocator++;

    const firstBad = steps.findIndex((step) => step.kind === 'unsupported');
    const head = firstBad === -1 ? steps : steps.slice(0, firstBad);
    if (head.some(hasLocator)) {
      prefix++;
      row.prefix++;
    }
    if (firstBad === -1 && steps.some(hasLocator)) {
      fully++;
      row.fully++;
      if (examples.length < 8) examples.push(`${rel} › ${title}`);
    }
    for (const step of steps) {
      if (step.kind === 'unsupported') reasons.set(bucket(step.reason), (reasons.get(bucket(step.reason)) ?? 0) + 1);
    }
    const blocker = steps[firstBad];
    if (blocker && blocker.kind === 'unsupported') {
      firstReasons.set(bucket(blocker.reason), (firstReasons.get(bucket(blocker.reason)) ?? 0) + 1);
    }
  }
  project.removeSourceFile(sourceFile);
}

const pct = (n: number, d: number): string => (d === 0 ? '0.0%' : `${((100 * n) / d).toFixed(1)}%`);
const top = (map: Map<string, number>, n: number): Array<[string, number]> => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);

console.log(`project:    ${root}`);
console.log(`pattern:    ${pattern}`);
console.log(`spec files: ${files.length}   tests: ${tests}   parse errors: ${parseErrors}`);
console.log(`statements: ${stepsTotal}   supported as-is: ${stepsSupported} (${pct(stepsSupported, stepsTotal)})`);
console.log(`tests with a page-rooted locator step anywhere:          ${anyLocator} (${pct(anyLocator, tests)})`);
console.log(`tests with a replayable prefix (healable surface today): ${prefix} (${pct(prefix, tests)})`);
console.log(`tests fully replayable from start to end:                ${fully} (${pct(fully, tests)})`);

console.log('\nper folder (tests / fully replayable / replayable prefix):');
for (const row of [...folders.values()].sort((a, b) => b.tests - a.tests).slice(0, 25)) {
  console.log(`  ${row.folder.padEnd(50)} ${String(row.tests).padStart(5)} / ${String(row.fully).padStart(5)} / ${String(row.prefix).padStart(5)}`);
}
console.log('\nwhere replay stops first (one entry per test), top 10:');
for (const [reason, count] of top(firstReasons, 10)) console.log(`  ${String(count).padStart(6)}  ${reason}`);
console.log('\nall unsupported statements by reason, top 12:');
for (const [reason, count] of top(reasons, 12)) console.log(`  ${String(count).padStart(6)}  ${reason}`);
if (examples.length > 0) {
  console.log('\nexamples of fully replayable tests:');
  for (const example of examples) console.log(`  ${example}`);
}
