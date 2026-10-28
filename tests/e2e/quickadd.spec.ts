// SPDX-License-Identifier: GPL-2.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Open Quick add the way the device does: the FAB on phones, the `n` key on desktop. */
async function openQuickAdd(page: Page) {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	if (test.info().project.name.startsWith('phone')) {
		await page.getByRole('button', { name: 'New reminder' }).click();
	} else {
		// Wait for the shell's key handler (it mounts with the layout).
		await page.locator('body').click({ position: { x: 5, y: 5 } });
		await page.keyboard.press('n');
	}
	const dialog = page.getByRole('dialog', { name: 'New reminder' });
	await expect(dialog).toBeVisible();
	return dialog;
}

/** The stored text of a vault file, read straight from IndexedDB. */
async function fileText(page: Page, path: string): Promise<string> {
	return page.evaluate(
		(p) =>
			new Promise<string>((resolve, reject) => {
				const open = indexedDB.open('fasti');
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const all = open.result.transaction('files').objectStore('files').getAll();
					all.onerror = () => reject(all.error);
					all.onsuccess = () => {
						const row = (all.result as { path: string; text: string }[]).find((r) => r.path === p);
						open.result.close();
						resolve(row?.text ?? '');
					};
				};
			}),
		path
	);
}

test('opens focused, with the placeholder and the file picker on the main file', async ({
	page
}) => {
	const dialog = await openQuickAdd(page);
	const field = dialog.getByLabel('Describe the reminder');
	await expect(field).toHaveAttribute(
		'placeholder',
		'Dentist next Thu 3:30pm, warn me 3 days before'
	);
	await expect(field).toBeFocused();
	await expect(dialog.getByLabel('Add to file')).toHaveValue('reminders.rem');
	await expect(dialog.getByRole('button', { name: 'Add reminder' })).toBeDisabled();
});

test('a phrase makes a REM line, an explanation and the engine next dates', async ({ page }) => {
	const dialog = await openQuickAdd(page);
	await dialog
		.getByLabel('Describe the reminder')
		.fill('Dentist next Thu 3:30pm, warn me 3 days before');
	const line = dialog.getByTestId('remline');
	await expect(line).toHaveText(/^REM \d{4}-\d{2}-\d{2} \+3 AT 15:30 MSG Dentist %b$/);
	// Syntax colours come from the lens tokenizer's roles.
	await expect(line.locator('.sx-cmd').first()).toHaveText('REM');
	await expect(line.locator('.sx-date').first()).toBeVisible();
	await expect(dialog.getByTestId('nextdates')).toBeVisible();
	await expect(dialog.getByTestId('nextdates').locator('li').first()).toContainText('3:30pm');
	await expect(dialog.locator('.explain li').first()).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Add reminder' })).toBeEnabled();
});

test('Adjust changes the line', async ({ page }) => {
	const dialog = await openQuickAdd(page);
	await dialog.getByLabel('Describe the reminder').fill('Water plants every Sunday');
	const line = dialog.getByTestId('remline');
	await expect(line).toHaveText('REM Sun MSG Water plants');
	await dialog.getByText('Adjust', { exact: true }).click();

	await dialog.getByRole('button', { name: 'Monday' }).click();
	await expect(dialog.getByRole('button', { name: 'Monday' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(line).toHaveText('REM Mon Sun MSG Water plants');

	await dialog.getByLabel('Heads-up').fill('2');
	await expect(line).toHaveText('REM Mon Sun +2 MSG Water plants %b');
	await dialog.getByLabel('Count days off').check();
	await expect(line).toHaveText('REM Mon Sun ++2 MSG Water plants %b');

	await dialog.getByRole('button', { name: 'Skip', exact: true }).click();
	await expect(line).toHaveText('REM Mon Sun ++2 SKIP MSG Water plants %b');
	await dialog.getByRole('button', { name: 'Day after' }).click();
	await expect(line).toHaveText('REM Mon Sun ++2 AFTER MSG Water plants %b');
	await dialog.getByRole('button', { name: 'Keep' }).click();

	await dialog.getByLabel('Time', { exact: true }).fill('09:15');
	await dialog.getByLabel('Duration').selectOption('30');
	await expect(line).toHaveText('REM Mon Sun ++2 AT 9:15 DURATION 0:30 MSG Water plants %b');
	await dialog.getByLabel('Message').fill('Feed cat');
	await dialog.getByLabel("It's a task (TODO)").check();
	await expect(line).toContainText('REM TODO Mon Sun ++2 COMPLETE-THROUGH ');
	await expect(line).toContainText('MSG Feed cat %b');
	await dialog.getByLabel('Add countdown %b').uncheck();
	await expect(line).toContainText('MSG Feed cat');
	await expect(line).not.toContainText('%b');

	await dialog.getByLabel('Repeats').selectOption('monthly-last');
	await expect(line).toContainText('Lastday');
	await expect(dialog.getByTestId('nextdates')).toBeVisible();
});

test('a line starting with REM or OMIT switches to raw mode', async ({ page }) => {
	const dialog = await openQuickAdd(page);
	const field = dialog.getByLabel('Describe the reminder');
	await field.fill('REM 2031-03-04 AT 8:00 MSG Raw one');
	await expect(dialog.getByText('Raw mode')).toBeVisible();
	await expect(dialog.getByTestId('remline')).toHaveText('REM 2031-03-04 AT 8:00 MSG Raw one');
	await expect(dialog.getByText('Adjust', { exact: true })).toHaveCount(0);
	await expect(dialog.getByTestId('nextdates')).toContainText('2031');
	await expect(dialog.getByRole('button', { name: 'Add reminder' })).toBeEnabled();

	// Remind refuses this line, so Add stays off and the engine's message shows.
	await field.fill('REM 2031-03-04 AT 25:99 MSG Nope');
	await expect(dialog.getByTestId('diagnostics')).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Add reminder' })).toBeDisabled();

	await field.fill('OMIT 24 Dec MSG Christmas Eve');
	await expect(dialog.getByRole('button', { name: 'Add reminder' })).toBeEnabled();

	await field.fill('Back to words tomorrow');
	await expect(dialog.getByText('Adjust', { exact: true })).toBeVisible();
});

test('Add appends to the file, closes the sheet, and Undo removes it', async ({ page }) => {
	const before = await (async () => {
		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expect.poll(() => fileText(page, 'reminders.rem')).toContain('Fasti demo vault');
		return fileText(page, 'reminders.rem');
	})();
	expect(before).not.toContain('MSG Quick e2e');

	const dialog = await openQuickAdd(page);
	const field = dialog.getByLabel('Describe the reminder');
	await field.fill('Quick e2e tomorrow at 3pm');
	const add = dialog.getByRole('button', { name: 'Add reminder' });
	await expect(add).toBeEnabled();
	const line = (await dialog.getByTestId('remline').textContent())!;
	expect(line).toMatch(/^REM \d{4}-\d{2}-\d{2} AT 15:00 MSG Quick e2e$/);
	await field.press('Enter');

	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByText('Added to reminders.rem')).toBeVisible();
	await expect.poll(() => fileText(page, 'reminders.rem')).toBe(before + line + '\n');

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(() => fileText(page, 'reminders.rem')).toBe(before);
});

test('Add goes to the chosen file', async ({ page }) => {
	const dialog = await openQuickAdd(page);
	await dialog.getByLabel('Describe the reminder').fill('Pick a file 2031-05-06');
	await dialog.getByLabel('Add to file').selectOption('birthdays.rem');
	const add = dialog.getByRole('button', { name: 'Add reminder' });
	await expect(add).toBeEnabled();
	await add.click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect
		.poll(() => fileText(page, 'birthdays.rem'))
		.toContain('REM 2031-05-06 MSG Pick a file\n');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect.poll(() => fileText(page, 'birthdays.rem')).not.toContain('Pick a file');
});

test('a refused date is flagged and blocks Add', async ({ page }) => {
	const dialog = await openQuickAdd(page);
	await dialog.getByLabel('Describe the reminder').fill('dentist 31 Feb');
	await expect(dialog.getByTestId('refused')).toContainText("I couldn't read '31 Feb' as a date");
	await expect(dialog.getByRole('button', { name: 'Add reminder' })).toBeDisabled();

	// Picking a date under Adjust settles it.
	await dialog.getByText('Adjust', { exact: true }).click();
	await dialog.getByLabel('Date', { exact: true }).fill('2031-02-14');
	await expect(dialog.getByTestId('refused')).toHaveCount(0);
	await expect(dialog.getByTestId('remline')).toContainText('REM 2031-02-14');
	await expect(dialog.getByRole('button', { name: 'Add reminder' })).toBeEnabled();

	await dialog.getByLabel('Describe the reminder').fill('dentist 2099-01-05');
	await expect(dialog.getByTestId('refused')).toContainText("'2099-01-05'");
});

test('fits 360 px and has no serious axe issues', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	const dialog = await openQuickAdd(page);
	await dialog.getByLabel('Describe the reminder').fill('Gym every Mon and Wed at 6pm for 1h');
	await expect(dialog.getByTestId('nextdates')).toBeVisible();
	await dialog.getByText('Adjust', { exact: true }).click();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	const box = await dialog.boundingBox();
	expect(box!.width).toBeLessThanOrEqual(360);

	const results = await new AxeBuilder({ page }).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('axe is clean with the sheet open at the default size', async ({ page }) => {
	const dialog = await openQuickAdd(page);
	await dialog.getByLabel('Describe the reminder').fill('dentist 31 Feb');
	await expect(dialog.getByTestId('refused')).toBeVisible();
	await dialog.getByText('Adjust', { exact: true }).click();
	const results = await new AxeBuilder({ page }).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('Escape closes without adding', async ({ page }) => {
	const dialog = await openQuickAdd(page);
	await dialog.getByLabel('Describe the reminder').fill('Never added tomorrow');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	expect(await fileText(page, 'reminders.rem')).not.toContain('Never added');
});
