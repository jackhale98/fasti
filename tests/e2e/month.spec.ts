// SPDX-License-Identifier: GPL-2.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The sample vault is seeded on first run. Tests run on the real date, so they
// assert structure, not particular days.

async function open(page: Page) {
	await page.goto('/month');
	await expect(page.getByTestId('day-cell')).toHaveCount(42, { timeout: 30_000 });
}

test('the grid renders 42 day cells under a month heading', async ({ page }) => {
	await open(page);
	await expect(page.getByRole('heading', { level: 1, name: 'Month' })).toBeVisible();
	await expect(page.getByTestId('month-heading')).toContainText(/\w+\s+\d{4}/);
	await expect(page.getByRole('columnheader')).toHaveCount(7);
	await expect(page.locator('[data-testid="day-cell"][aria-current="date"]')).toHaveCount(1);
});

test('weekend cells are days off, named so for screen readers', async ({ page }) => {
	await open(page);
	const off = page.locator('[data-testid="day-cell"][data-off="weekly"]');
	// 6 rows of 7 days always hold at least 10 weekend days.
	expect(await off.count()).toBeGreaterThanOrEqual(10);
	await expect(off.first()).toHaveAccessibleName(/, day off/);
	await expect(page.getByTestId('day-cell').first()).toHaveAccessibleName(
		/^\w+day \d+ \w+, \d+ reminders?/
	);
});

test('Previous, Next and Today change the heading', async ({ page }) => {
	await open(page);
	const heading = page.getByTestId('month-heading');
	const start = await heading.innerText();
	await page.getByRole('button', { name: 'Next month' }).click();
	await expect(heading).not.toHaveText(start);
	await expect(page.getByTestId('day-cell')).toHaveCount(42);
	await page.getByRole('button', { name: 'Next month' }).click();
	const later = await heading.innerText();
	await page.getByRole('button', { name: 'Previous month' }).click();
	await expect(heading).not.toHaveText(later);
	await page.getByRole('button', { name: 'Today', exact: true }).click();
	await expect(heading).toHaveText(start);
	await expect(page.locator('[data-testid="day-cell"][aria-current="date"]')).toHaveCount(1);
});

test('selecting a day shows its heading and list', async ({ page }) => {
	await open(page);
	// Find a day with entries.
	const withEntries = page.locator(
		'[data-testid="day-cell"]:not(.out):not([aria-label*=", 0 reminders"])'
	);
	expect(await withEntries.count()).toBeGreaterThan(0);
	const cell = withEntries.first();
	const name = (await cell.getAttribute('aria-label')) ?? '';
	await cell.click();
	await expect(cell.locator('xpath=..')).toHaveAttribute('aria-selected', 'true');
	const heading = page.getByTestId('day-heading');
	const [, weekday, day, monthName] = /^(\w+) (\d+) (\w+),/.exec(name) ?? [];
	await expect(heading).toContainText(`${weekday} ${day} ${monthName}`.replace(/\s+/g, ' '));
	const count = Number(/, (\d+) reminder/.exec(name)?.[1]);
	await expect(page.locator('.list > li')).toHaveCount(count);
});

test('arrow keys move the selected day; Enter selects', async ({ page }) => {
	await open(page);
	const stop = page.locator('[data-testid="day-cell"][tabindex="0"]');
	await expect(stop).toHaveCount(1);
	await stop.focus();
	const before = await stop.getAttribute('data-date');
	await page.keyboard.press('ArrowRight');
	const next = page.locator('[data-testid="day-cell"][tabindex="0"]');
	await expect(next).toBeFocused();
	expect(await next.getAttribute('data-date')).not.toBe(before);
	await expect(next).toHaveClass(/sel/);
	const after = await next.getAttribute('data-date');
	await page.keyboard.press('ArrowDown');
	const down = page.locator('[data-testid="day-cell"][tabindex="0"]');
	await expect(down).toBeFocused();
	expect(await down.getAttribute('data-date')).not.toBe(after);
	await page.keyboard.press('ArrowUp');
	await expect(page.locator('[data-testid="day-cell"][tabindex="0"]')).toHaveAttribute(
		'data-date',
		after!
	);
	await page.keyboard.press('Enter');
	await expect(page.locator('[data-testid="day-cell"][tabindex="0"]')).toHaveClass(/sel/);
});

test('the grid fits 360 px without sideways scrolling', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await open(page);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});

test('axe finds no serious issues, with and without a day selected', async ({ page }) => {
	await open(page);
	const check = async () => {
		const results = await new AxeBuilder({ page }).analyze();
		return results.violations
			.filter((v) => v.impact === 'serious' || v.impact === 'critical')
			.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.html.slice(0, 200)).join(' | ')}`);
	};
	expect(await check()).toEqual([]);
	await page.getByTestId('day-cell').nth(10).click();
	expect(await check()).toEqual([]);
});
