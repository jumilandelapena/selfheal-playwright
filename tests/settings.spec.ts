import { expect, test } from '@playwright/test';

// Written against APP_VERSION=1.

test.describe('settings', () => {
  test('turns on dark mode', async ({ page }) => {
    await page.goto('/settings');
    await page.locator('#dark-mode').check();
    await expect(page.locator('body')).toHaveClass(/dark/);
  });

  test('saves the language choice', async ({ page }) => {
    await page.goto('/settings');
    await page.locator('#language').selectOption('de');
    // `.btn` is unique on this page in v1. In v2 the "back" link is also a
    // `.btn`, which turns this click into a strict-mode violation.
    await page.locator('.btn').click();
    await expect(page.locator('#toast')).toHaveText('Settings saved');
  });

  test('keeps email notifications off until switched on', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('checkbox', { name: 'Email notifications' })).not.toBeChecked();
    await page.getByTestId('notify-toggle').check();
    await expect(page.getByRole('checkbox', { name: 'Email notifications' })).toBeChecked();
  });

  test('links back to the task list', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('link', { name: 'Back to tasks' }).click();
    await expect(page).toHaveURL(/\/todos$/);
  });
});
