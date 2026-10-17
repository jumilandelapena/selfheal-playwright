import { expect, test } from '@playwright/test';

// Written against APP_VERSION=1. The healer replays `beforeEach` hooks and
// `test.step` blocks when it reproduces a failure.

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
  });

  test('marks a task as done', async ({ page }) => {
    await page.getByLabel('Task title').fill('Buy milk');
    await page.getByRole('button', { name: 'Add task' }).click();
    await page.locator('.toggle').check();
    await expect(page.getByRole('checkbox', { name: 'Mark Buy milk as done' })).toBeChecked();
  });

  test('deletes a task', async ({ page }) => {
    await page.getByLabel('Task title').fill('Buy milk');
    await page.getByRole('button', { name: 'Add task' }).click();
    await page.locator('.delete').click();
    await expect(page.getByText('Buy milk')).toHaveCount(0);
  });

  test('shows how many tasks are left', async ({ page }) => {
    await page.getByLabel('Task title').fill('Buy milk');
    await page.getByRole('button', { name: 'Add task' }).click();
    await page.getByLabel('Task title').fill('Walk the dog');
    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(page.locator('#count')).toHaveText('2 tasks left');
  });
});
