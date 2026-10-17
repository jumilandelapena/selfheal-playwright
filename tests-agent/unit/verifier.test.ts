import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ActionStep, Candidate, ExpectStep } from '../../src/healer/types.js';
import { verifyCandidate } from '../../src/healer/verifier.js';

let browser: Browser;
let page: Page;

const html = `
<main>
  <h1>Settings</h1>
  <button class="btn" id="save">Save changes</button>
  <a class="btn" href="#">Back</a>
  <div id="toast" hidden>Settings saved</div>
  <p id="count">2 tasks left</p>
  <ul><li class="task">a</li><li class="task">b</li></ul>
  <input id="name" aria-label="Name">
</main>`;

const candidate = (locator: string): Candidate => ({ locator, kind: 'css', confidence: 0.9, reason: 'test' });
// Same timeout the healer uses. A cold page can need more than 500 ms before
// the first click passes Playwright's "stable" check.
const timeout = 3_000;
const click: ActionStep = { kind: 'action', action: 'click', args: [], locator: "page.locator('#old')", startLine: 1, endLine: 1, text: '' };
const fill: ActionStep = { ...click, action: 'fill', args: ['Alice'] };
const toHaveText = (text: string): ExpectStep => ({
  kind: 'expect',
  target: 'locator',
  locator: "page.locator('#old')",
  matcher: 'toHaveText',
  not: false,
  args: [text],
  startLine: 1,
  endLine: 1,
  text: '',
});

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
beforeEach(() => page.setContent(html));
afterAll(() => browser.close());

describe('verifyCandidate', () => {
  it('rejects a candidate that matches no element', async () => {
    const result = await verifyCandidate(page, candidate("page.locator('#missing')"), click, { timeout: 500 });
    expect(result).toMatchObject({ status: 'rejected', count: 0, detail: 'matches no element' });
  });

  it('rejects a candidate that matches two or more elements', async () => {
    const result = await verifyCandidate(page, candidate("page.locator('.btn')"), click, { timeout: 500 });
    expect(result).toMatchObject({ status: 'rejected', count: 2 });
    expect(result.detail).toContain('matches 2 elements');
  });

  it('rejects a unique but hidden element', async () => {
    const result = await verifyCandidate(page, candidate("page.locator('#toast')"), toHaveText('Settings saved'), { timeout: 500 });
    expect(result).toMatchObject({ status: 'rejected', count: 1 });
    expect(result.detail).toContain('not visible');
  });

  it('passes a unique visible element on which the action succeeds', async () => {
    const result = await verifyCandidate(page, candidate("page.getByRole('button', { name: 'Save changes' })"), click, { timeout });
    expect(result).toMatchObject({ status: 'passed', count: 1 });
  });

  it('rejects when the original action fails on the element', async () => {
    const result = await verifyCandidate(page, candidate("page.locator('#save')"), fill, { timeout: 500 });
    expect(result.status).toBe('rejected');
    expect(result.detail).toContain('fill failed');
  });

  it('runs the original assertion with its expected value', async () => {
    expect((await verifyCandidate(page, candidate("page.locator('#count')"), toHaveText('2 tasks left'), { timeout })).status).toBe('passed');
    const wrong = await verifyCandidate(page, candidate("page.locator('#count')"), toHaveText('3 tasks left'), { timeout: 500 });
    expect(wrong.status).toBe('rejected');
    expect(wrong.detail).toContain('expect.toHaveText failed');
  });

  it('expects the asserted count for toHaveCount instead of exactly one element', async () => {
    const step: ExpectStep = { ...toHaveText(''), matcher: 'toHaveCount', args: [2] };
    expect((await verifyCandidate(page, candidate("page.locator('.task')"), step, { timeout })).status).toBe('passed');
    expect((await verifyCandidate(page, candidate("page.locator('#count')"), step, { timeout: 500 })).status).toBe('rejected');
  });

  it('rejects brittle locators before touching the page', async () => {
    const result = await verifyCandidate(page, candidate("page.locator('.btn').first()"), click, { timeout: 500 });
    expect(result).toMatchObject({ status: 'rejected' });
    expect(result.detail).toContain('positional');
    expect(result.count).toBeUndefined();
  });
});
