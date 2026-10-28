// SPDX-License-Identifier: GPL-2.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
	await page.goto('/settings');
	await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
	// The vault loads asynchronously: the select fills once it has.
	await expect(page.getByLabel('Main entry').locator('option')).not.toHaveCount(1);
}

/** Open the month view on a Thursday in the current month and return the day list text. */
async function thursdayList(page: Page) {
	await page.goto('/month');
	await expect(page.getByTestId('day-cell')).toHaveCount(42, { timeout: 30_000 });
	await page.locator('[data-testid="day-cell"]:not(.out)[aria-label^="Thursday"]').first().click();
	return page.getByRole('main');
}

test('sections come in order with labelled controls', async ({ page }) => {
	await open(page);
	const headings = await page
		.getByRole('main')
		.getByRole('heading', { level: 2 })
		.allTextContents();
	const top = headings.filter((h) =>
		['Your files', 'Display', 'Notifications', 'Calendar export', 'About'].includes(h)
	);
	expect(top).toEqual(['Your files', 'Display', 'Notifications', 'Calendar export', 'About']);
	for (const legend of ['Week starts on', 'Times', 'Tasks', 'Theme'])
		await expect(page.getByRole('group', { name: legend })).toBeVisible();
	await expect(page.getByTestId('files-read')).toContainText('reminders.rem');
	await expect(page.getByTestId('files-read')).toContainText('holidays.rem');
});

test('Monday start persists and reorders the Month header', async ({ page }) => {
	await open(page);
	await page.getByRole('radio', { name: 'Monday' }).check();
	await page.reload();
	await expect(page.getByRole('radio', { name: 'Monday' })).toBeChecked();
	await page.goto('/month');
	await expect(page.getByRole('columnheader').first()).toHaveText(/Mon/);
	await expect(page.getByRole('columnheader').last()).toHaveText(/Sun/);
	await page.goto('/settings');
	await page.getByRole('radio', { name: 'Sunday' }).check();
	await page.goto('/month');
	await expect(page.getByRole('columnheader').first()).toHaveText(/Sun/);
});

test('24-hour times persist and show 14:00 for Design review', async ({ page }) => {
	await open(page);
	await page.getByRole('radio', { name: /^24-hour/ }).check();
	await page.reload();
	await expect(page.getByRole('radio', { name: /^24-hour/ })).toBeChecked();
	const main = await thursdayList(page);
	await expect(main.getByText('Design review').locator('visible=true').first()).toBeVisible();
	await expect(main.getByText('14:00').locator('visible=true').first()).toBeVisible();
	await page.goto('/settings');
	await page.getByRole('radio', { name: /^12-hour/ }).check();
	const again = await thursdayList(page);
	await expect(
		again
			.getByText(/^2(:00)?pm/)
			.locator('visible=true')
			.first()
	).toBeVisible();
});

test('hide completed TODOs persists', async ({ page }) => {
	await open(page);
	const box = page.getByRole('checkbox', { name: 'Hide completed TODOs' });
	await box.check();
	await page.reload();
	await expect(box).toBeChecked();
	await page.goto('/month');
	await expect(page.getByTestId('day-cell')).toHaveCount(42, { timeout: 30_000 });
	await page.goto('/settings');
	await expect(box).toBeChecked();
	await box.uncheck();
	await page.reload();
	await expect(box).not.toBeChecked();
});

test('theme is saved and applied', async ({ page }) => {
	await open(page);
	await page.getByRole('radio', { name: 'Dark' }).check();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.reload();
	await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.getByRole('radio', { name: 'Match the system' }).check();
	await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('the main entry can be changed and persists', async ({ page }) => {
	await open(page);
	const select = page.getByLabel('Main entry');
	await expect(select).toHaveValue('reminders.rem');
	await select.selectOption('birthdays.rem');
	await expect(page.getByTestId('files-read')).not.toContainText('holidays.rem');
	await expect(page.getByTestId('files-read')).toContainText('birthdays.rem');
	await page.reload();
	await expect(page.getByLabel('Main entry')).toHaveValue('birthdays.rem');
	await page.getByLabel('Main entry').selectOption('');
	await expect(page.getByTestId('files-read')).toContainText('holidays.rem');
	await page.getByLabel('Main entry').selectOption('reminders.rem');
});

async function chooseFiles(page: Page, files: { name: string; text: string }[]) {
	// Without the File System Access API Fasti falls back to an <input type="file">.
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Import files' }).click();
	await (
		await chooser
	).setFiles(
		files.map((f) => ({ name: f.name, mimeType: 'text/plain', buffer: Buffer.from(f.text) }))
	);
}

test('import shows the add/replace plan and confirms before writing', async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = undefined;
	});
	await open(page);
	await chooseFiles(page, [
		{ name: 'extra.rem', text: 'REM 1 Jan MSG Extra\n' },
		{ name: 'holidays.rem', text: 'OMIT 25 Dec MSG Changed\n' }
	]);
	const dialog = page.getByRole('dialog', { name: 'Import files' });
	const plan = dialog.getByTestId('import-plan');
	await expect(plan).toContainText('Will be added (1)');
	await expect(plan).toContainText('extra.rem');
	await expect(plan).toContainText('Will replace a different file of the same name (1)');
	await expect(plan).toContainText('holidays.rem');

	// Cancelling writes nothing.
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(
		page.getByLabel('Main entry').locator('option', { hasText: 'extra.rem' })
	).toHaveCount(0);

	// Add new files only: extra.rem arrives, holidays.rem stays.
	await chooseFiles(page, [
		{ name: 'extra.rem', text: 'REM 1 Jan MSG Extra\n' },
		{ name: 'holidays.rem', text: 'OMIT 25 Dec MSG Changed\n' }
	]);
	await dialog.getByRole('button', { name: 'Add new files only' }).click();
	await expect(
		page.getByLabel('Main entry').locator('option', { hasText: 'extra.rem' })
	).toHaveCount(1);
	await page.goto('/script');
	await page.getByRole('tab', { name: 'holidays.rem' }).click();
	await expect(page.getByText('Changed')).toHaveCount(0);
});

test('import can replace a changed file after confirmation', async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = undefined;
	});
	await open(page);
	await chooseFiles(page, [{ name: 'birthdays.rem', text: 'REM 2 Nov MSG Replaced\n' }]);
	const dialog = page.getByRole('dialog', { name: 'Import files' });
	await dialog.getByRole('button', { name: 'Add and replace' }).click();
	await expect(page.getByRole('status')).toContainText('Imported 1 file');
	await page.getByRole('button', { name: 'Undo' }).click();
});

test('export as zip downloads the vault', async ({ page }) => {
	await open(page);
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export as zip' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe('fasti-vault.zip');
	const path = await file.path();
	const { readFileSync } = await import('node:fs');
	const bytes = readFileSync(path);
	expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
	expect(bytes.toString('latin1')).toContain('reminders.rem');
});

test('reset asks first, says what is lost, and restores the sample', async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = undefined;
	});
	await open(page);
	await chooseFiles(page, [{ name: 'mine.rem', text: 'REM 3 Mar MSG Mine\n' }]);
	await page
		.getByRole('dialog', { name: 'Import files' })
		.getByRole('button', { name: 'Add files' })
		.click();
	await expect(
		page.getByLabel('Main entry').locator('option', { hasText: 'mine.rem' })
	).toHaveCount(1);

	await page.getByRole('button', { name: 'Reset local data' }).click();
	const dialog = page.getByRole('dialog', { name: 'Reset local data?' });
	await expect(dialog).toContainText('cannot be undone');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(
		page.getByLabel('Main entry').locator('option', { hasText: 'mine.rem' })
	).toHaveCount(1);

	await page.getByRole('button', { name: 'Reset local data' }).click();
	await page.getByRole('button', { name: 'Delete and reset' }).click();
	await expect(
		page.getByLabel('Main entry').locator('option', { hasText: 'mine.rem' })
	).toHaveCount(0);
	await expect(page.getByLabel('Main entry')).toHaveValue('reminders.rem');
	await expect(page.getByTestId('files-read')).toContainText('holidays.rem');
});

test('no serious axe issues, with a dialog open too', async ({ page }) => {
	await open(page);
	const scan = async () => {
		const results = await new AxeBuilder({ page }).analyze();
		return results.violations
			.filter((v) => v.impact === 'serious' || v.impact === 'critical')
			.map((v) => `${v.id}: ${v.help}`);
	};
	expect(await scan()).toEqual([]);
	await page.getByRole('button', { name: 'Reset local data' }).click();
	await expect(page.getByRole('dialog', { name: 'Reset local data?' })).toBeVisible();
	expect(await scan()).toEqual([]);
});

test('fits 360 px without sideways scrolling', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await open(page);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});
