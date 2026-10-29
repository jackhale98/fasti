// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from '@playwright/test';

test.skip(({ isMobile }) => isMobile, 'one layout is enough');

test('a window whose database a newer Fasti took over offers Reload and keeps typing', async ({
	page,
	context
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/script');
	const editor = page.getByRole('textbox', { name: /^Editing / });
	await expect(editor).toContainText('Stand-up', { timeout: 20_000 });

	// A "newer build" in another window opens the database at a higher version.
	const other = await context.newPage();
	await other.goto('/settings');
	await other.evaluate(
		() =>
			new Promise<void>((resolve, reject) => {
				const req = indexedDB.open('fasti', 99);
				req.onsuccess = () => {
					req.result.close();
					resolve();
				};
				req.onerror = () => reject(req.error);
			})
	);

	await expect(page.getByText('Fasti was updated in another window')).toBeVisible();
	await editor.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' kept');
	await page.waitForTimeout(1500); // past the save debounce
	// Nothing was saved and nothing was thrown away: the text is still in the editor.
	await expect(editor).toContainText('kept');
	await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
	await page.goto('/settings').catch(() => {});
	expect(errors).toEqual([]);
});
