// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test, type Page } from '@playwright/test';

test.skip(({ isMobile }) => !isMobile, 'phone sheet only');

/** Open the first reminder on Today in its sheet. */
async function openSheet(page: Page) {
	await page.goto('/');
	const row = page.locator('li > button.main').first();
	await row.waitFor({ timeout: 30_000 });
	await row.click();
	const sheet = page.getByRole('dialog', { name: 'Reminder' });
	await expect(sheet).toBeVisible();
	// Let the opening animation finish before measuring or dragging.
	await page.waitForFunction(() =>
		document.getAnimations().every((a) => a.playState !== 'running')
	);
	return sheet;
}

/** A one-finger drag through the Chrome DevTools protocol (real touch events). */
async function touchDrag(page: Page, x: number, from: number, to: number, steps = 10) {
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y?: number) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: y === undefined ? [] : [{ x: Math.round(x), y: Math.round(y) }]
		});
	await touch('touchStart', from);
	for (let i = 1; i <= steps; i++) await touch('touchMove', from + ((to - from) * i) / steps);
	await touch('touchEnd');
}

test('the page behind an open sheet does not scroll', async ({ page }) => {
	const sheet = await openSheet(page);
	expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe(
		'hidden'
	);
	await sheet.getByLabel('Close').click();
	await expect(sheet).toBeHidden();
	expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe(
		'hidden'
	);
});

test('pulling the sheet down closes it; a short pull springs back', async ({ page }) => {
	const sheet = await openSheet(page);
	const head = (await sheet.getByRole('heading', { name: 'Reminder', exact: true }).boundingBox())!;
	const x = head.x + 20;
	const y = head.y + head.height / 2;
	await touchDrag(page, x, y, y + 40, 8);
	await page.waitForTimeout(300);
	await expect(sheet).toBeVisible();
	expect(
		(await sheet.getByRole('heading', { name: 'Reminder', exact: true }).boundingBox())!.y
	).toBeCloseTo(head.y, 0);
	await touchDrag(page, x, y, y + 260);
	await expect(sheet).toBeHidden();
});
