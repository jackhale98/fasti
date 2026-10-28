// SPDX-License-Identifier: GPL-2.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** The text of a stored file, read straight from IndexedDB. */
async function stored(page: Page, path: string): Promise<string | null> {
	return page.evaluate(
		(p) =>
			new Promise<string | null>((resolve, reject) => {
				const open = indexedDB.open('fasti');
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const get = open.result.transaction('files').objectStore('files').get(['browser', p]);
					get.onsuccess = () => {
						open.result.close();
						resolve(get.result ? (get.result.text as string) : null);
					};
					get.onerror = () => reject(get.error);
				};
			}),
		path
	);
}

/** Puts a file into the browser vault with exactly these characters. */
async function seed(page: Page, path: string, text: string) {
	await page.evaluate(
		([p, t]: [string, string]) =>
			new Promise<void>((resolve, reject) => {
				const open = indexedDB.open('fasti');
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const tx = open.result.transaction('files', 'readwrite');
					tx.objectStore('files').put({
						vault: 'browser',
						path: p,
						text: t,
						base: null,
						rev: null,
						dirty: true,
						eol: t.includes('\r\n') ? 'CRLF' : t.includes('\n') ? 'LF' : 'none',
						finalNewline: t.endsWith('\n'),
						bom: false
					});
					tx.oncomplete = () => {
						open.result.close();
						resolve();
					};
					tx.onerror = () => reject(tx.error);
				};
			}),
		[path, text] as [string, string]
	);
}

async function openScript(page: Page) {
	await page.goto('/script');
	await expect(page.getByRole('tab', { name: /^reminders\.rem/ })).toBeVisible({ timeout: 20_000 });
}

const editor = (page: Page) => page.getByRole('textbox', { name: /^Editing / });

test('every file has a tab and switching shows its text', async ({ page }) => {
	await openScript(page);
	const tabs = page.getByRole('tablist', { name: 'Files' }).getByRole('tab');
	await expect(tabs).toHaveCount(3);
	await expect(page.getByRole('tab', { name: /^reminders\.rem/ })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(editor(page)).toContainText('Stand-up');
	await page.getByRole('tab', { name: /^holidays\.rem/ }).click();
	await expect(page.getByRole('tab', { name: /^holidays\.rem/ })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(editor(page)).toContainText('Days off');
	await expect(editor(page)).not.toContainText('Stand-up');
});

test('typing is saved to the file, and a mistake shows as a problem', async ({ page }) => {
	await openScript(page);
	const before = (await stored(page, 'reminders.rem'))!;
	await editor(page).click();
	await page.keyboard.press('Control+End');
	await page.keyboard.type('REM 2026-03-03 MSG Typed 1');
	await expect
		.poll(() => stored(page, 'reminders.rem'))
		.toBe(before + 'REM 2026-03-03 MSG Typed 1');
	await page.keyboard.press('Escape');
	await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
	await page.keyboard.press('Enter');
	// CodeMirror delays Enter briefly on Android-style input; let it land before typing on.
	await page.waitForTimeout(300);
	await page.keyboard.type('REM 2026-03-04 AT 25:99 MSG bad 5');
	await expect(page.getByRole('region', { name: 'Problems' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Problems' }).getByRole('button')).toHaveCount(1);
	await expect(page.locator('.cm-lintRange').first()).toBeVisible();
	// Clicking the problem puts the cursor on its line, and the inspector follows.
	await page.getByRole('region', { name: 'Problems' }).getByRole('button').click();
	await expect(page.getByRole('region', { name: 'Line inspector' })).toContainText(/Line \d+/);
});

test('the inspector explains the line under the cursor and shows dates from the engine', async ({
	page
}) => {
	await openScript(page);
	const inspector = page.getByRole('region', { name: 'Line inspector' });
	await editor(page).click();
	await page.keyboard.press('Control+Home');
	await expect(inspector).toContainText('Line 1');
	await expect(inspector).toContainText('A comment');
	await editor(page).getByText('Stand-up').click();
	await expect(inspector).toContainText('Line 8');
	await expect(inspector).toContainText('Every weekday');
	await expect(inspector.getByRole('list').first()).toBeVisible();
	await expect(inspector.getByText('Next dates')).toBeVisible();
	await expect(inspector.locator('time').first()).toBeVisible({ timeout: 15_000 });
});

test('the key strip inserts at the cursor', async ({ page }) => {
	await openScript(page);
	await editor(page).click();
	await page.keyboard.press('Control+End');
	await page.getByRole('button', { name: 'Insert TODO' }).click();
	await expect
		.poll(async () => (await stored(page, 'reminders.rem'))!.endsWith('TODO '))
		.toBe(true);
});

test('a CRLF file keeps its line endings and changes only where typed', async ({ page }) => {
	await page.goto('/script');
	await expect(page.getByRole('tab', { name: /^reminders\.rem/ })).toBeVisible({ timeout: 20_000 });
	const original = '# crlf file\r\nREM 2026-01-01 MSG one\r\n\r\nREM 2026-01-02 MSG two\r\n';
	await seed(page, 'crlf.rem', original);
	await page.reload();
	await page.getByRole('tab', { name: /^crlf\.rem/ }).click();
	await expect(editor(page)).toContainText('MSG two');
	await editor(page).click();
	// In the middle: the first line.
	await page.keyboard.press('Control+Home');
	await page.keyboard.type('## ');
	await expect.poll(() => stored(page, 'crlf.rem')).toBe('## ' + original);
	// At the end, with a new line (the editor adds the file's own CRLF).
	await page.keyboard.press('Control+End');
	await page.keyboard.type('REM 2026-01-03 MSG three 4');
	await page.keyboard.press('Escape');
	await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
	await page.keyboard.press('Enter');
	await expect
		.poll(() => stored(page, 'crlf.rem'))
		.toBe('## ' + original + 'REM 2026-01-03 MSG three 4\r\n');
	// Deleting a line break keeps the others.
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Backspace');
	await expect
		.poll(() => stored(page, 'crlf.rem'))
		.toBe(
			'## # crlf file\r\nREM 2026-01-01 MSG one\r\nREM 2026-01-02 MSG two\r\nREM 2026-01-03 MSG three 4\r\n'
		);
});

test('a file without a final newline stays without one', async ({ page }) => {
	await page.goto('/script');
	await expect(page.getByRole('tab', { name: /^reminders\.rem/ })).toBeVisible({ timeout: 20_000 });
	const original = '# no newline at the end\nREM 2026-01-01 MSG last';
	await seed(page, 'nonl.rem', original);
	await page.reload();
	await page.getByRole('tab', { name: /^nonl\.rem/ }).click();
	await expect(editor(page)).toContainText('MSG last');
	await editor(page).click();
	await page.keyboard.press('Control+Home');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.type('# ');
	await expect
		.poll(() => stored(page, 'nonl.rem'))
		.toBe('# no newline at the end\n# REM 2026-01-01 MSG last');
	await page.keyboard.press('Control+End');
	await page.keyboard.type('!');
	await expect
		.poll(() => stored(page, 'nonl.rem'))
		.toBe('# no newline at the end\n# REM 2026-01-01 MSG last!');
	await expect(page.getByText('No final newline')).toBeVisible();
});

test('files Remind does not read are marked', async ({ page }) => {
	await page.goto('/script');
	await expect(page.getByRole('tab', { name: /^reminders\.rem/ })).toBeVisible({ timeout: 20_000 });
	await seed(page, 'orphan.rem', 'REM 2026-01-01 MSG nobody includes me\n');
	await page.reload();
	await expect(page.getByRole('tab', { name: /^orphan\.rem.*not read by Remind/ })).toBeVisible();
	await page.getByRole('tab', { name: /^orphan\.rem/ }).click();
	await expect(page.getByText('Remind does not read this file')).toBeVisible();
});

test('keyboard: Tab reaches the editor and leaves it; arrow keys move between tabs', async ({
	page
}) => {
	await openScript(page);
	const first = page.getByRole('tab', { name: /^reminders\.rem/ });
	await first.focus();
	await page.keyboard.press('ArrowRight');
	await expect(
		page.getByRole('tab', { name: /^holidays\.rem|^birthdays\.rem/ }).first()
	).toBeFocused();
	await editor(page).focus();
	await page.keyboard.press('Tab');
	await expect(editor(page)).not.toBeFocused();
});

test('fits 360 px without sideways scrolling and has no serious axe issues', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await openScript(page);
	await expect(editor(page)).toContainText('Stand-up');
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	await editor(page).click();
	const results = await new AxeBuilder({ page }).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	expect(
		serious.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target).join(' ')}`)
	).toEqual([]);
});
