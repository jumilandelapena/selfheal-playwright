/**
 * CI guard: fail unless the heal report shows at least N healed tests.
 *
 *   pnpm exec tsx scripts/assert-heals.ts --min 6 [--report heal-output/heal-report.json]
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { HealReport } from '../src/healer/types.js';

const { values } = parseArgs({
  options: {
    min: { type: 'string', default: '1' },
    report: { type: 'string', default: 'heal-output/heal-report.json' },
  },
});

const min = Number(values.min);
const report = JSON.parse(readFileSync(values.report, 'utf8')) as HealReport;
const { healedTests, healedLocators, unhealedTests, revertedLocators } = report.summary;

console.log(
  `heal report: ${healedTests} test(s) healed with ${healedLocators} locator(s); ` +
    `${revertedLocators} reverted, ${unhealedTests} unhealed (minimum required: ${min})`,
);
for (const test of report.tests) console.log(`  ${test.status.padEnd(8)} ${test.testId} — ${test.detail}`);

if (healedTests < min) {
  console.error(`FAIL: expected at least ${min} healed test(s)`);
  process.exit(1);
}
