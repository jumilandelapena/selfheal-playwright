import { describe, expect, it } from 'vitest';
import { classifyFailure, stripAnsi } from '../../src/healer/classifier.js';

// Messages captured from Playwright 1.64 runs of the demo suite.
const actionTimeout = `TimeoutError: locator.click: Timeout 3000ms exceeded.
Call log:
  - waiting for locator('#login-btn')


   9 |     await page.getByLabel('Username').fill('alice');
  10 |     await page.getByLabel('Password').fill('wrong-password');
> 11 |     await page.locator('#login-btn').click();
     |                                      ^
  12 |     await expect(page.locator('.error-msg')).toHaveText('Invalid username or password');
    at C:\\repo\\tests\\login.spec.ts:11:38`;

const roleTimeout = `TimeoutError: locator.click: Timeout 3000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Log in' })
`;

const strictMode = `Error: strict mode violation: locator('.btn') resolved to 2 elements:
    1) <button data-testid="save" class="btn" type="submit">Save changes</button> aka getByRole('button', { name: 'Save changes' })
    2) <a class="btn btn-link" href="/todos">Back to tasks</a> aka getByRole('link', { name: 'Back to tasks' })

Call log:
  - waiting for locator('.btn')
`;

const expectNotFound = `Error: expect(locator).toHaveText(expected) failed

Locator: locator('.error-msg')
Expected: "Invalid username or password"
Timeout: 3000ms
Error: element(s) not found

Call log:
  - Expect "toHaveText" locator('.error-msg') with timeout 3000ms
  - waiting for locator('.error-msg')
`;

const expectMismatch = `Error: expect(locator).toHaveText(expected) failed

Locator:  locator('#count')
Expected: "2 tasks left"
Received: "1 task left"
Timeout:  3000ms

Call log:
  - Expect "toHaveText" locator('#count') with timeout 3000ms
  - waiting for locator('#count')
    6 × locator resolved to <p id="count">1 task left</p>
      - unexpected value "1 task left"
`;

const expectHidden = `Error: expect(locator).toBeVisible() failed

Locator:  locator('#toast')
Expected: visible
Received: hidden
Timeout:  3000ms
`;

const expectCountZero = `Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.todo-item')
Expected: 1
Received: 0
Timeout:  3000ms

Call log:
  - Expect "toHaveCount" locator('.todo-item') with timeout 3000ms
  - waiting for locator('.todo-item')
    6 × locator resolved to 0 elements
      - unexpected value "0"
`;

const jestAssertion = `Error: expect(received).toBe(expected) // Object.is equality

Expected: 2
Received: 1
`;

const pageAssertion = `Error: expect(page).toHaveURL(expected) failed

Expected pattern: /todos/
Received string:  "about:blank"
Timeout: 3000ms
`;

const foundButDisabled = `TimeoutError: locator.click: Timeout 3000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Save' })
    - locator resolved to <button disabled class="btn">Save</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
`;

const gotoTimeout = `TimeoutError: page.goto: Timeout 10000ms exceeded.
Call log:
  - navigating to "http://localhost:4173/login", waiting until "load"
`;

describe('classifyFailure', () => {
  it('treats an action timeout on a missing element as a healable locator timeout', () => {
    const result = classifyFailure(actionTimeout);
    expect(result).toMatchObject({ kind: 'locator-timeout', healable: true, locator: "locator('#login-btn')" });
  });

  it('extracts role locators from the call log', () => {
    expect(classifyFailure(roleTimeout).locator).toBe("getByRole('button', { name: 'Log in' })");
  });

  it('treats a strict-mode violation as healable', () => {
    const result = classifyFailure(strictMode);
    expect(result).toMatchObject({ kind: 'strict-mode', healable: true, locator: "locator('.btn')" });
    expect(result.reason).toContain('2 elements');
  });

  it('treats an assertion on a missing element as healable', () => {
    const result = classifyFailure(expectNotFound);
    expect(result).toMatchObject({ kind: 'element-not-found', healable: true, locator: "locator('.error-msg')" });
  });

  it('never heals an assertion whose element exists but has the wrong value', () => {
    expect(classifyFailure(expectMismatch)).toMatchObject({ kind: 'assertion', healable: false });
    expect(classifyFailure(expectHidden)).toMatchObject({ kind: 'assertion', healable: false });
  });

  it('is conservative about toHaveCount receiving 0', () => {
    expect(classifyFailure(expectCountZero)).toMatchObject({ kind: 'assertion', healable: false });
  });

  it('never heals plain value assertions or page-level assertions', () => {
    expect(classifyFailure(jestAssertion)).toMatchObject({ kind: 'assertion', healable: false });
    expect(classifyFailure(pageAssertion)).toMatchObject({ kind: 'assertion', healable: false });
  });

  it('does not heal when the element was found but the action could not complete', () => {
    const result = classifyFailure(foundButDisabled);
    expect(result.healable).toBe(false);
    expect(result.kind).toBe('other');
  });

  it('does not heal navigation timeouts', () => {
    expect(classifyFailure(gotoTimeout)).toMatchObject({ kind: 'other', healable: false });
  });

  it('ignores ANSI colour codes', () => {
    const coloured = `\x1b[31mTimeoutError: locator.fill: Timeout 3000ms exceeded.\x1b[0m\nCall log:\n  - waiting for \x1b[36mlocator('#new-todo')\x1b[0m\n`;
    expect(stripAnsi(coloured)).not.toContain('\x1b');
    expect(classifyFailure(coloured)).toMatchObject({ kind: 'locator-timeout', locator: "locator('#new-todo')" });
  });
});
