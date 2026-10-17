/**
 * Replays parsed steps on a real page and runs single actions/expectations.
 * Uses the same `expect` as the test runner, so a verified candidate behaves
 * exactly like it will in the test.
 */
import { chromium, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { buildLocator, parseLocatorExpression } from './locator-expression.js';
import type { Literal, Step } from './types.js';

/** Supported locator actions and how many leading arguments are values (the rest are options). */
export const ACTION_VALUE_ARGS: Readonly<Record<string, number>> = {
  click: 0,
  dblclick: 0,
  hover: 0,
  check: 0,
  uncheck: 0,
  clear: 0,
  focus: 0,
  blur: 0,
  tap: 0,
  selectText: 0,
  scrollIntoViewIfNeeded: 0,
  waitFor: 0,
  fill: 1,
  type: 1,
  pressSequentially: 1,
  press: 1,
  selectOption: 1,
  setChecked: 1,
  dispatchEvent: 1,
};

/** Matchers with an explicit value-argument count; `toBe*` matchers take none, `toHave*` take one. */
const MATCHER_VALUE_ARGS: Readonly<Record<string, number>> = {
  toHaveAttribute: 2,
  toHaveCSS: 2,
  toHaveJSProperty: 2,
};

/** These need test-runner state (snapshots, polling) and cannot run standalone. */
export const UNSUPPORTED_MATCHERS: ReadonlySet<string> = new Set(['toHaveScreenshot', 'toPass']);

export function matcherValueCount(matcher: string): number {
  return MATCHER_VALUE_ARGS[matcher] ?? (matcher.startsWith('toBe') ? 0 : 1);
}

export class BrowserSession {
  private constructor(private readonly browser: Browser) {}

  static async launch(): Promise<BrowserSession> {
    return new BrowserSession(await chromium.launch());
  }

  async newPage(baseURL: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await this.browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    return { context, page };
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp);
}

/** Split literal arguments into values + an options object that carries the timeout. */
function withTimeout(args: Literal[], valueCount: number, timeout: number): unknown[] {
  const values = args.slice(0, valueCount);
  const extra = args[valueCount];
  const options = isPlainObject(extra) ? { ...extra, timeout } : { timeout };
  return [...values, options];
}

export async function performAction(locator: Locator, action: string, args: Literal[], timeout: number): Promise<void> {
  const valueCount = ACTION_VALUE_ARGS[action];
  if (valueCount === undefined) throw new Error(`unsupported action: ${action}`);
  const method = (locator as unknown as Record<string, unknown>)[action];
  if (typeof method !== 'function') throw new Error(`locator.${action} is not a function`);
  await (method as (...a: unknown[]) => Promise<unknown>).apply(locator, withTimeout(args, valueCount, timeout));
}

export async function performExpect(
  target: Locator | Page,
  matcher: string,
  not: boolean,
  args: Literal[],
  timeout: number,
): Promise<void> {
  if (UNSUPPORTED_MATCHERS.has(matcher)) throw new Error(`expect().${matcher}() is not supported here`);
  const base = expect(target as Locator);
  const expectation = not ? base.not : base;
  const method = (expectation as unknown as Record<string, unknown>)[matcher];
  if (typeof method !== 'function') throw new Error(`expect().${matcher} is not a function`);
  await (method as (...a: unknown[]) => Promise<unknown>).apply(
    expectation,
    withTimeout(args, matcherValueCount(matcher), timeout),
  );
}

export async function runStep(page: Page, step: Step, timeout: number): Promise<void> {
  switch (step.kind) {
    case 'goto':
      await page.goto(step.url, { ...step.options, timeout });
      return;
    case 'action':
      await performAction(buildLocator(page, parseLocatorExpression(step.locator)), step.action, step.args, timeout);
      return;
    case 'expect': {
      const target =
        step.target === 'page' ? page : buildLocator(page, parseLocatorExpression(step.locator ?? ''));
      await performExpect(target, step.matcher, step.not, step.args, timeout);
      return;
    }
    case 'unsupported':
      throw new Error(`unsupported step at line ${step.startLine}: ${step.reason}`);
  }
}

export async function replaySteps(page: Page, steps: Step[], timeout: number): Promise<void> {
  for (const step of steps) await runStep(page, step, timeout);
}
