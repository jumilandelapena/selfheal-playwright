import type { Locator, Page } from '@playwright/test';
import { validateCandidate, buildLocator } from './locator-expression.js';
import { performAction, performExpect } from './replay.js';
import { describeStep } from './steps.js';
import type { ActionStep, Candidate, CandidateResult, ExpectStep } from './types.js';

export interface VerifyOptions {
  /** Timeout for the replayed action or assertion. */
  timeout?: number;
}

/** Matchers that legitimately target an element which is not visible. */
function requiresVisible(step: ActionStep | ExpectStep): boolean {
  if (step.kind === 'action') return true;
  if (step.matcher === 'toBeHidden' || step.matcher === 'toBeAttached') return false;
  if (step.not && step.matcher === 'toBeVisible') return false;
  return true;
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? text;
}

/**
 * A candidate passes only when it resolves to exactly one element (or to the
 * count a `toHaveCount` assertion expects), the element is visible, and the
 * original action or assertion succeeds against it. The page must already be
 * in the state right before the failing step.
 */
export async function verifyCandidate(
  page: Page,
  candidate: Candidate,
  step: ActionStep | ExpectStep,
  options: VerifyOptions = {},
): Promise<CandidateResult> {
  const timeout = options.timeout ?? 3_000;
  const validation = validateCandidate(candidate.locator);
  if (!validation.ok) return { ...candidate, status: 'rejected', detail: validation.reason };

  let locator: Locator;
  try {
    locator = buildLocator(page, validation.parsed);
  } catch (error) {
    return { ...candidate, status: 'rejected', detail: firstLine(error instanceof Error ? error.message : String(error)) };
  }

  const expectedCount =
    step.kind === 'expect' && step.matcher === 'toHaveCount' && typeof step.args[0] === 'number' ? step.args[0] : 1;
  const count = await locator.count();
  if (count !== expectedCount) {
    const detail = count === 0 ? 'matches no element' : `matches ${count} elements, expected ${expectedCount}`;
    return { ...candidate, status: 'rejected', count, detail };
  }

  if (expectedCount === 1 && requiresVisible(step) && !(await locator.isVisible())) {
    return { ...candidate, status: 'rejected', count, detail: 'matches one element but it is not visible' };
  }

  const what = describeStep(step);
  try {
    if (step.kind === 'action') await performAction(locator, step.action, step.args, timeout);
    else await performExpect(locator, step.matcher, step.not, step.args, timeout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...candidate, status: 'rejected', count, detail: `${what} failed: ${firstLine(message)}` };
  }
  return { ...candidate, status: 'passed', count, detail: `matches ${count} element(s) and ${what} succeeded` };
}
