import { expect, test } from '@playwright/test';

// Written against APP_VERSION=1. With APP_VERSION=2 the ids, classes and
// button text change, so the CSS and text locators below stop matching.

test.describe('login', () => {
  test('shows an error for a wrong password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('alice');
    await page.getByLabel('Password').fill('wrong-password');
    await page.locator('#login-btn').click();
    await expect(page.locator('.error-msg')).toHaveText('Invalid username or password');
  });

  test('signs in and lands on the task list', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('alice');
    await page.getByLabel('Password').fill('secret123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/todos$/);
    await expect(page.getByText('Signed in as alice')).toBeVisible();
  });

  test('shows the welcome heading', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('lets the user tick "remember me"', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('remember-me').check();
    await expect(page.getByRole('checkbox', { name: 'Remember me' })).toBeChecked();
  });
});
