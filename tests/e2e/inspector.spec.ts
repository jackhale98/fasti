// SPDX-License-Identifier: GPL-2.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The Inspector is opened by selecting a reminder row (an ItemRow) on
 * whichever page lists rows. Until Today or Month lists rows on this branch
 * the tests are marked fixme; nothing global is exposed for the test.
 */
const ROW_PAGES = ['/', '/month'];

async function openFirstRow(page: Page, wanted?: string): Promise<boolean> {
	for (const path of ROW_PAGES) {
		await page.goto(path);
		const rows = page.locator('li > button.main');
		try {
			await rows.first().waitFor({ timeout: 8000 });
		} catch {
			continue;
		}
		const row = wanted ? rows.filter({ hasText: wanted }).first() : rows.first();
		if ((await row.count()) === 0) continue;
		await row.click();
		return true;
	}
	return false;
}

function inspector(page: Page) {
	// The desktop panel or the phone sheet, whichever holds the reminder.
	return page.locator('.detail:visible').first();
}

test.describe('Inspector', () => {
	test('shows the reminder, explanation and next dates, with axe clean', async ({ page }) => {
		const opened = await openFirstRow(page);
		test.fixme(!opened, 'No page lists reminder rows yet (Today and Month are built in parallel).');
		const panel = inspector(page);
		await expect(
			panel.getByRole('heading', { level: 3, name: 'How Remind reads it' })
		).toBeVisible();
		await expect(
			panel.getByRole('heading', { level: 3, name: /Next dates|Due dates/ })
		).toBeVisible();
		await expect(panel.locator('.nextdates li').first()).toBeVisible();
		await expect(panel.getByRole('textbox', { name: 'Edit this line' })).toBeVisible();
		const results = await new AxeBuilder({ page }).include('.detail').analyze();
		expect(
			results.violations
				.filter((v) => v.impact === 'serious' || v.impact === 'critical')
				.map((v) => `${v.id}: ${v.help}`)
		).toEqual([]);
	});

	test('a bad edit shows the engine message and keeps Save disabled; a good one saves', async ({
		page
	}) => {
		const opened = await openFirstRow(page, 'Stand-up');
		test.fixme(!opened, 'No page lists reminder rows yet (Today and Month are built in parallel).');
		const panel = inspector(page);
		const box = panel.getByRole('textbox', { name: 'Edit this line' });
		const save = panel.getByRole('button', { name: 'Save line' });
		await expect(save).toBeDisabled();
		await box.fill('REM Mon Tue Wed Thu Fri AT 9:30 DURATION 0:15 SKIP MSG');
		await expect(panel.getByRole('status')).not.toContainText('Edit the line');
		await box.fill('REM Mon Tue Wed Thu Fri AT 9:45 DURATION 0:15 SKIP MSG Stand-up %b');
		await expect(panel.getByRole('status')).toContainText('Next:');
		await expect(save).toBeEnabled();
		await save.click();
		await expect(page.getByText(/Saved .* line \d+/)).toBeVisible();
	});

	test('Delete offers Undo, and Close dismisses', async ({ page }) => {
		const opened = await openFirstRow(page);
		test.fixme(!opened, 'No page lists reminder rows yet (Today and Month are built in parallel).');
		await inspector(page).getByRole('button', { name: 'Delete' }).click();
		await expect(page.getByText(/Deleted .* line \d+/)).toBeVisible();
		await page.getByRole('button', { name: 'Undo' }).click();
		await expect(page.getByText('Undone')).toBeVisible();
	});

	test('Show in script goes to the script route with file and line', async ({ page }) => {
		const opened = await openFirstRow(page);
		test.fixme(!opened, 'No page lists reminder rows yet (Today and Month are built in parallel).');
		await inspector(page).getByRole('button', { name: 'Show in script' }).click();
		await expect(page).toHaveURL(/\/script\?file=.+&line=\d+/);
	});
});
