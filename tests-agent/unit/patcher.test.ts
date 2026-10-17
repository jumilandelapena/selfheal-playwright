import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { patchLocator, revertPatch } from '../../src/healer/patcher.js';

const source = `import { expect, test } from '@playwright/test';

test('one', async ({ page }) => {
  await page.goto('/login');   // trailing comment
  await page.locator('#login-btn').click();
  await expect(page.locator('.error-msg')).toHaveText('Invalid username or password');
});

test('two', async ({ page }) => {
  await page.locator('#login-btn').click();
  await expect(page.locator('.error-msg')).toHaveText('Invalid username or password');
});
`;

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'selfheal-patch-'));
  file = path.join(dir, 'login.spec.ts');
  writeFileSync(file, source, 'utf8');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('patchLocator', () => {
  it('replaces exactly one locator and leaves every other byte identical', () => {
    const result = patchLocator({
      filePath: file,
      line: 5,
      oldLocator: "page.locator('#login-btn')",
      newLocator: "page.getByRole('button', { name: 'Sign in' })",
    });
    const after = readFileSync(file, 'utf8');
    const expected = source.slice(0, result.start) + "page.getByRole('button', { name: 'Sign in' })" + source.slice(result.end);
    expect(after).toBe(expected);
    // The same locator on line 10 is untouched, and so is the assertion.
    expect(after.split('\n')[9]).toBe("  await page.locator('#login-btn').click();");
    expect(after).toContain(".toHaveText('Invalid username or password')");
    expect(after.match(/#login-btn/g)).toHaveLength(1);
  });

  it('patches a locator inside an expect() without touching the expected value', () => {
    patchLocator({ filePath: file, line: 6, oldLocator: "page.locator('.error-msg')", newLocator: "page.getByRole('alert')" });
    const after = readFileSync(file, 'utf8');
    expect(after.split('\n')[5]).toBe("  await expect(page.getByRole('alert')).toHaveText('Invalid username or password');");
    expect(after.split('\n')[10]).toBe("  await expect(page.locator('.error-msg')).toHaveText('Invalid username or password');");
  });

  it('keeps CRLF line endings', () => {
    const crlf = source.replace(/\n/g, '\r\n');
    writeFileSync(file, crlf, 'utf8');
    const result = patchLocator({ filePath: file, line: 5, oldLocator: "page.locator('#login-btn')", newLocator: "page.getByTestId('signin')" });
    const after = readFileSync(file, 'utf8');
    expect(after).toBe(crlf.slice(0, result.start) + "page.getByTestId('signin')" + crlf.slice(result.end));
    expect(after).toContain('\r\n');
  });

  it('can be reverted', () => {
    const patch = patchLocator({ filePath: file, line: 5, oldLocator: "page.locator('#login-btn')", newLocator: "page.getByTestId('signin')" });
    revertPatch(patch);
    expect(readFileSync(file, 'utf8')).toBe(source);
  });

  it('fails loudly when the locator is not on that line', () => {
    expect(() =>
      patchLocator({ filePath: file, line: 4, oldLocator: "page.locator('#login-btn')", newLocator: "page.getByTestId('x')" }),
    ).toThrow('not found on line 4');
    expect(() =>
      patchLocator({ filePath: file, line: 5, oldLocator: "page.locator('#login-btn')", newLocator: "page.locator('#login-btn')" }),
    ).toThrow('identical');
    expect(readFileSync(file, 'utf8')).toBe(source);
  });
});
