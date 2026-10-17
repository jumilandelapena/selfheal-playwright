import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import {
  buildLocator,
  LocatorRef,
  normaliseLocatorText,
  parseLocatorExpression,
  validateCandidate,
} from '../../src/healer/locator-expression.js';

/** A stand-in for `page` that records the chain of calls instead of touching a browser. */
function fakePage(): { page: Page; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const node = (): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get: (_target, method: string) => {
          if (method === 'then') return undefined;
          return (...args: unknown[]) => {
            calls.push({ method, args });
            return node();
          };
        },
      },
    );
  return { page: node() as unknown as Page, calls };
}

describe('normaliseLocatorText', () => {
  it('adds the page prefix, trims and collapses whitespace', () => {
    expect(normaliseLocatorText("  getByText('x');")).toBe("page.getByText('x')");
    expect(normaliseLocatorText("page.getByRole('button',\n  { name: 'Go' })")).toBe(
      "page.getByRole('button', { name: 'Go' })",
    );
  });
});

describe('parseLocatorExpression', () => {
  it('parses a chain with literal arguments', () => {
    const parsed = parseLocatorExpression("page.getByRole('button', { name: 'Sign in', exact: true })");
    expect(parsed.calls).toEqual([{ method: 'getByRole', args: ['button', { name: 'Sign in', exact: true }] }]);
  });

  it('parses regular expressions, numbers and nested chains', () => {
    const parsed = parseLocatorExpression("page.locator('li').filter({ has: page.getByText(/milk/i) }).nth(2)");
    expect(parsed.calls.map((c) => c.method)).toEqual(['locator', 'filter', 'nth']);
    const filterArg = parsed.calls[1]?.args[0] as { has: LocatorRef };
    expect(filterArg.has).toBeInstanceOf(LocatorRef);
    expect(filterArg.has.parsed.calls[0]?.args[0]).toEqual(/milk/i);
    expect(parsed.calls[2]?.args).toEqual([2]);
  });

  it.each([
    "page.evaluate('document.title')",
    "document.querySelector('#x')",
    'page.locator(selector)',
    "page.locator('a').click()",
    'page.locator(`#${id}`)',
    "require('fs')",
    "page.locator('x'); process.exit()",
    "page.locator('x', { has: fetch('/') })",
    'page',
    '',
  ])('rejects %s', (text) => {
    expect(() => parseLocatorExpression(text)).toThrow();
  });
});

describe('validateCandidate', () => {
  it.each([
    ["page.locator('li').first()", 'positional'],
    ["page.locator('li').nth(3)", 'positional'],
    ["page.locator('ul > li:nth-child(2)')", 'nth-child'],
    ["page.locator('xpath=//button')", 'XPath'],
    ["page.locator('//button')", 'XPath'],
    ["page.locator('.css-1x2y3z')", 'auto-generated'],
    ["page.locator('.Button_root__a1b2c3')", 'hashed'],
    ["page.locator('.btn-5f3a9c2e')", 'hashed'],
  ])('rejects %s', (text, reason) => {
    const result = validateCandidate(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });

  it.each([
    "page.getByRole('button', { name: 'Sign in' })",
    "page.getByTestId('task-count')",
    "page.getByLabel('Dark mode')",
    "page.locator('form [name=username]')",
    "page.locator('li').filter({ hasText: 'Buy milk' })",
  ])('accepts %s', (text) => {
    expect(validateCandidate(text).ok).toBe(true);
  });
});

describe('buildLocator', () => {
  it('replays the chain on the page object with materialised arguments', () => {
    const { page, calls } = fakePage();
    buildLocator(page, parseLocatorExpression("page.locator('li').filter({ has: page.getByText('x') }).first()"));
    // The nested locator is built while the `filter` arguments are materialised.
    expect(calls.map((c) => c.method)).toEqual(['locator', 'getByText', 'filter', 'first']);
    expect(calls[0]?.args).toEqual(['li']);
    expect(calls[1]?.args).toEqual(['x']);
  });

  it('refuses an empty chain', () => {
    const { page } = fakePage();
    expect(() => buildLocator(page, { text: 'page', calls: [] })).toThrow('empty');
  });
});
