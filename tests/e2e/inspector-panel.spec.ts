// SPDX-License-Identifier: GPL-2.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(() => {
	test.skip(!test.info().project.name.startsWith('desktop'), 'the panel is desktop only');
});

test('the desktop inspector hides and shows, by button and by the i key, and is remembered', async ({
	page
}) => {
	await page.goto('/');
	await expect(page.getByText(/^Reminders for /)).toBeVisible();
	const panel = page.getByRole('complementary', { name: 'Inspector' });
	await expect(panel).toBeVisible();
	const mainWidth = async () => (await page.locator('main').boundingBox())!.width;
	const before = await mainWidth();

	await page.getByRole('button', { name: 'Hide inspector' }).click();
	await expect(panel).toBeHidden();
	expect(await mainWidth()).toBeGreaterThan(before + 300);
	await page.reload();
	await expect(page.getByText(/^Reminders for /)).toBeVisible();
	await expect(panel).toBeHidden();

	await page.getByRole('button', { name: 'Show inspector' }).click();
	await expect(panel).toBeVisible();

	await page.locator('main').click({ position: { x: 5, y: 5 } });
	await page.keyboard.press('i');
	await expect(panel).toBeHidden();
	await page.keyboard.press('i');
	await expect(panel).toBeVisible();
});

test('selecting a reminder shows a hidden inspector', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText(/^Reminders for /)).toBeVisible();
	await page.getByRole('button', { name: 'Hide inspector' }).click();
	const panel = page.getByRole('complementary', { name: 'Inspector' });
	await expect(panel).toBeHidden();
	await page.locator('main li .msg').first().click();
	await expect(panel).toBeVisible();
	await expect(panel.locator('.title')).toBeVisible();
});

test('no serious axe issues with the inspector hidden', async ({ page }) => {
	await page.goto('/month');
	await page.getByRole('button', { name: 'Hide inspector' }).click();
	const results = await new AxeBuilder({ page }).analyze();
	expect(
		results.violations
			.filter((v) => v.impact === 'serious' || v.impact === 'critical')
			.map((v) => v.id)
	).toEqual([]);
});
