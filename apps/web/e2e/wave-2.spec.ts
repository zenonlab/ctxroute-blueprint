import { expect, test } from '@playwright/test';

test('Alice navigates inbox, library and a work detail', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bonjour Alice' })).toBeVisible();
  await expect(page.getByText('Planifié', { exact: true }).first()).toBeVisible();
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Bibliothèque' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.goto('/library/orbital-knights');
  await expect(page.getByRole('heading', { name: 'Orbital Knights' }).first()).toBeVisible();
  await expect(page.getByText('Sources (2)').first()).toBeVisible();
});

test('planned releases never expose an open action and broken sources are stale', async ({ page }) => {
  await page.goto('/calendar');
  const planned = page.locator('.release-row').filter({ hasText: 'Paper Moon Hero' });
  await expect(planned.getByText('Planifié', { exact: true }).first()).toBeVisible();
  await expect(planned.getByText('Aucune ouverture', { exact: true }).first()).toBeVisible();
  await page.goto('/sources');
  await expect(page.getByText('fixture-anime-old v1')).toBeVisible();
  await expect(page.getByText('Erreur')).toBeVisible();
});

test('admin surface is role-gated and contains no personal favorites', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Changer de profil' }).click();
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Santé et sécurité' })).toBeVisible();
  await expect(page.getByText('Alice et Bob')).toBeVisible();
  await expect(page.getByText('Orbital Knights')).not.toBeVisible();
});

test('mobile uses the bottom navigation', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile project only');
  await page.goto('/');
  await expect(page.locator('.mobile-nav')).toBeVisible();
  await page.locator('.mobile-nav').getByText('Bibliothèque').click();
  await expect(page.getByRole('heading', { name: 'Bibliothèque' })).toBeVisible();
});
