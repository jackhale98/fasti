// SPDX-License-Identifier: GPL-2.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const VIEWS: { path: string; heading: string | RegExp }[] = [
	// Today's heading is the weekday.
	{ path: '/', heading: /^(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day$/ },
	{ path: '/month', heading: 'Month' },
	{ path: '/script', heading: 'Script' },
	{ path: '/sync', heading: 'Your files' },
	{ path: '/settings', heading: 'Settings' }
];

for (const view of VIEWS) {
	test(`${view.path} loads with status 200, no errors and no serious axe issues`, async ({
		page
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		page.on('console', (message) => {
			if (message.type() === 'error') errors.push(message.text());
		});
		const response = await page.goto(view.path);
		expect(response?.status()).toBe(200);
		await expect(page.getByRole('heading', { level: 1, name: view.heading })).toBeVisible();
		const results = await new AxeBuilder({ page }).analyze();
		const serious = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		);
		expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
		// A CSP violation (an inline script without its hash) shows up as a console error.
		expect(errors).toEqual([]);
	});

	test(`${view.path} fits a 360 px screen without sideways scrolling`, async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 740 });
		await page.goto(view.path);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
}

test('the views link to each other and mark the current one', async ({ page }) => {
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Views' });
	await nav.getByRole('link', { name: 'Month' }).click();
	await expect(page).toHaveURL(/\/month$/);
	await expect(nav.getByRole('link', { name: 'Month' })).toHaveAttribute('aria-current', 'page');
	await expect(page.getByRole('heading', { level: 1, name: 'Month' })).toBeVisible();
});

test('Settings carries the notices and a source link', async ({ page }) => {
	await page.goto('/settings');
	const main = page.getByRole('main');
	await expect(main.getByText('not affiliated with or endorsed by Remind')).toBeVisible();
	await expect(main.getByText('built with AI assistance')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Source code' })).toHaveAttribute(
		'href',
		'https://github.com/jackhale98/fasti'
	);
});

test('the theme choice applies and is remembered', async ({ page }) => {
	await page.goto('/settings');
	await page.getByRole('radio', { name: 'Dark' }).check();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.getByRole('radio', { name: 'Match the system' }).check();
	await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('the skip link moves focus to the content', async ({ page }) => {
	await page.goto('/month');
	await expect(page.getByRole('heading', { level: 1, name: 'Month' })).toBeVisible();
	await page.keyboard.press('Tab');
	const skip = page.getByRole('link', { name: 'Skip to content' });
	await expect(skip).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator('main')).toBeFocused();
});
