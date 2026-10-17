import { describe, expect, it } from 'vitest';
import { describeStep, parseTestSteps } from '../../src/healer/steps.js';

const spec = `import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('tasks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/todos');
  });

  test('adds a task', async ({ page }) => {
    await test.step('type a title and submit it', async () => {
      await page.locator('#new-todo').fill('Buy milk');
      await page.getByText('Add task').click();
    });
    await expect(page.getByText('Buy milk')).toBeVisible();
    await expect(page).toHaveURL(/todos/);
    await expect(page.getByRole('checkbox', { name: 'Done' })).not.toBeChecked();
  });

  test('uses unsupported statements', async ({ page }) => {
    const title = 'x';
    await page.evaluate(() => document.title);
    await page.locator('#a').fill(title);
    await expect(page.locator('#b')).toHaveScreenshot();
    await page.getByRole('button').click();
  });
});

test('dup', async ({ page }) => {
  await page.goto('/a');
});
test('dup', async ({ page }) => {
  await page.goto('/b');
});
`;

describe('parseTestSteps', () => {
  it('flattens hooks, test.step blocks and expectations into steps', () => {
    const { steps, line } = parseTestSteps(spec, 'tasks.spec.ts', 'adds a task');
    expect(line).toBe(12);
    expect(steps.map(describeStep)).toEqual([
      'goto',
      'goto',
      'fill',
      'click',
      'expect.toBeVisible',
      'expect.toHaveURL',
      'expect.not.toBeChecked',
    ]);
    // File-level hook first, then the describe-level hook.
    expect(steps[0]).toMatchObject({ kind: 'goto', url: '/' });
    expect(steps[1]).toMatchObject({ kind: 'goto', url: '/todos' });
    expect(steps[2]).toMatchObject({
      kind: 'action',
      locator: "page.locator('#new-todo')",
      action: 'fill',
      args: ['Buy milk'],
      stepTitle: 'type a title and submit it',
      startLine: 14,
      endLine: 14,
    });
    expect(steps[4]).toMatchObject({ kind: 'expect', target: 'locator', locator: "page.getByText('Buy milk')", matcher: 'toBeVisible', not: false });
    expect(steps[5]).toMatchObject({ kind: 'expect', target: 'page', matcher: 'toHaveURL', args: [/todos/] });
    expect(steps[6]).toMatchObject({ kind: 'expect', not: true, matcher: 'toBeChecked' });
  });

  it('marks statements it cannot replay as unsupported, without throwing', () => {
    const { steps } = parseTestSteps(spec, 'tasks.spec.ts', 'uses unsupported statements');
    const kinds = steps.slice(2).map((s) => (s.kind === 'unsupported' ? `unsupported: ${s.reason}` : s.kind));
    expect(kinds[0]).toContain('VariableStatement');
    expect(kinds[1]).toContain('not a page.goto');
    expect(kinds[2]).toContain('unsupported argument: title');
    expect(kinds[3]).toContain('toHaveScreenshot');
    expect(kinds[4]).toBe('action');
  });

  it('uses the spec line to tell duplicate titles apart', () => {
    expect(parseTestSteps(spec, 'tasks.spec.ts', 'dup', 31).steps[1]).toMatchObject({ url: '/a' });
    expect(parseTestSteps(spec, 'tasks.spec.ts', 'dup', 34).steps[1]).toMatchObject({ url: '/b' });
    expect(() => parseTestSteps(spec, 'tasks.spec.ts', 'dup')).toThrow('more than once');
    expect(() => parseTestSteps(spec, 'tasks.spec.ts', 'missing')).toThrow('not found');
  });
});
