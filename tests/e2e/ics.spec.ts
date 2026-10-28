// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'Calendar export' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Export .ics' })).toBeEnabled({ timeout: 30_000 });
}

test('Export .ics downloads a file with events', async ({ page }) => {
	await open(page);
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export .ics' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/^fasti-\d{4}-\d{2}\.ics$/);
	const text = await readFile((await file.path())!, 'utf8');
	expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
	expect(text).toContain('PRODID:-//Fasti//Fasti//EN');
	expect(text.split('BEGIN:VEVENT').length - 1).toBeGreaterThan(10);
	expect(text.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
	await expect(page.getByTestId('ics-status')).toContainText(/Exported \d+ events? to fasti-/);
});

test('picking files needs at least one, and the note says it is a snapshot', async ({ page }) => {
	await open(page);
	await expect(page.getByText(/snapshot/)).toBeVisible();
	await page.getByRole('radio', { name: 'Pick files' }).check();
	await expect(page.getByRole('button', { name: 'Export .ics' })).toBeDisabled();
	await page.getByRole('checkbox').nth(0).check();
	await expect(page.getByRole('button', { name: 'Export .ics' })).toBeEnabled();
});

test('the section is axe clean and fits 360 px', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 800 });
	await open(page);
	const whole = await new AxeBuilder({ page }).analyze();
	expect(whole.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
		[]
	);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
