// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from '@playwright/test';

// Checks across views, on the sample vault the app seeds on first run.

test('the inspector title reads as Today shows it (an overdue task is not "today")', async ({
	page
}) => {
	await page.goto('/');
	const overdue = page
		.getByRole('region', { name: /Overdue/ })
		.or(page.locator('section', { hasText: 'Overdue' }));
	const row = overdue.locator('li .msg').first();
	await expect(row).toBeVisible();
	const text = (await row.textContent())?.trim() ?? '';
	expect(text).toMatch(/ago/);
	await row.click();
	await expect(page.locator('.detail:visible .title')).toHaveText(text);
});

test('Month selects today when it shows the current month', async ({ page }) => {
	await page.goto('/');
	const banner = page.locator('main').getByText(/^Reminders for /);
	await expect(banner).toBeVisible();
	await page.goto('/month');
	const today = page.locator('[aria-selected="true"]');
	await expect(today).toHaveCount(1);
	await expect(today.locator('button').first()).toHaveAccessibleName(/today/);
});

test('on phones the New button hides while the Month drawer is expanded', async ({ page }) => {
	test.skip(!test.info().project.name.startsWith('phone'), 'phones only');
	await page.goto('/month');
	const fab = page.getByRole('button', { name: 'New reminder' });
	await expect(fab).toBeVisible();
	const handle = page.getByRole('button', { name: 'Day details' });
	await handle.click();
	await expect(handle).toHaveAttribute('aria-expanded', 'true');
	await expect(fab).toBeHidden();
	await page.keyboard.press('Escape');
	await expect(handle).toHaveAttribute('aria-expanded', 'false');
	await expect(fab).toBeVisible();
});
