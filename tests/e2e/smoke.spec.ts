// SPDX-License-Identifier: GPL-2.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('the start page loads with its notices', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});

	const response = await page.goto('/');
	expect(response?.status()).toBe(200);
	await expect(page.getByRole('heading', { level: 1, name: 'Fasti' })).toBeVisible();
	await expect(page.getByText('not affiliated with or endorsed by Remind')).toBeVisible();
	await expect(page.getByText('built with AI assistance')).toBeVisible();
	// A CSP violation (an inline script without its hash) shows up as a console error.
	expect(errors).toEqual([]);
});

test('the start page has no serious or critical accessibility issues', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	const results = await new AxeBuilder({ page }).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('the page fits a 360 px screen without sideways scrolling', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});
