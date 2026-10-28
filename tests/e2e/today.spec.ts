// SPDX-License-Identifier: GPL-2.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await page.goto('/');
	await expect(page.locator('.banner')).toBeVisible({ timeout: 30_000 });
});

test('shows Remind banner, weekday heading and sections', async ({ page }) => {
	await expect(page.locator('.banner')).toContainText(/^Reminders for .+\d{4}.*:$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/
	);
	await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible();
	const next = page.getByRole('region', { name: 'Next two weeks' });
	await expect(next).toBeVisible();
	await expect(next.getByRole('heading', { level: 3 }).first()).toBeVisible();
	await expect(next.getByRole('listitem').first()).toBeVisible();
});

test('a TODO done circle marks it done and Undo restores it', async ({ page }) => {
	const circles = page.getByRole('button', { name: /^Mark .* done through / });
	await expect(circles.first()).toBeVisible();
	const before = await circles.count();
	const label = (await circles.first().getAttribute('aria-label')) ?? '';
	await circles.first().click();
	const toast = page.getByRole('status').filter({ hasText: 'Done through' });
	await expect(toast).toBeVisible();
	await expect(circles).toHaveCount(before - 1);
	await toast.getByRole('button', { name: 'Undo' }).click();
	await expect(circles).toHaveCount(before);
	await expect(page.getByRole('button', { name: label }).first()).toBeVisible();
});

test('clicking a row selects it', async ({ page }) => {
	const row = page.locator('li.item .main').first();
	await row.click();
	await expect(row).toHaveAttribute('aria-current', 'true');
});

test('has no serious axe violations in either theme and fits 360 px', async ({ page }) => {
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		const results = await new AxeBuilder({ page }).analyze();
		const serious = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		);
		expect(serious.map((v) => `${theme} ${v.id}: ${v.help}`)).toEqual([]);
	}
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});
