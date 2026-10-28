// SPDX-License-Identifier: GPL-2.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The sample vault is seeded on first run. Tests run on the real date, so they
// assert structure, not particular days.

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1000) < 720;
const handleOf = (page: Page) => page.getByRole('button', { name: 'Day details' });

/** On phones the day's list lives in the drawer; open it. */
async function expandIfPhone(page: Page) {
	if (!isPhone(page)) return;
	const handle = handleOf(page);
	if ((await handle.getAttribute('aria-expanded')) !== 'true') await handle.click();
	await expect(handle).toHaveAttribute('aria-expanded', 'true');
}

/** Wait for a month slide to end: only the new month's grid is left. */
const settled = (page: Page) => expect(page.getByRole('grid', { name: 'Month' })).toHaveCount(1);

async function open(page: Page) {
	await page.goto('/month');
	await expect(page.getByTestId('day-cell')).toHaveCount(42, { timeout: 30_000 });
}

test('the grid renders 42 day cells under a month heading', async ({ page }) => {
	await open(page);
	await expect(page.getByRole('heading', { level: 1, name: 'Month' })).toBeAttached();
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
	await expect(page.getByTestId('day-cell')).toHaveCount(42);
	await expect(page.locator('[data-testid="day-cell"][aria-current="date"]')).toHaveCount(1);
});

test('selecting a day shows its heading and list', async ({ page }) => {
	await open(page);
	await expandIfPhone(page);
	// Find a day with entries.
	const withEntries = page.locator(
		'[data-testid="day-cell"]:not(.out):not([aria-label*=", 0 reminders"])'
	);
	expect(await withEntries.count()).toBeGreaterThan(0);
	const cell = withEntries.first();
	const name = (await cell.getAttribute('aria-label')) ?? '';
	if (isPhone(page)) await page.keyboard.press('Escape'); // the grid is inert while the drawer is open
	await cell.click();
	await expect(cell.locator('xpath=..')).toHaveAttribute('aria-selected', 'true');
	await expandIfPhone(page);
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
	await settled(page);
	const down = page.locator('[data-testid="day-cell"][tabindex="0"]');
	await expect(down).toBeFocused();
	expect(await down.getAttribute('data-date')).not.toBe(after);
	await page.keyboard.press('ArrowUp');
	await settled(page);
	await expect(page.locator('[data-testid="day-cell"][tabindex="0"]')).toHaveAttribute(
		'data-date',
		after!
	);
	await page.keyboard.press('Enter');
	await expect(page.locator('[data-testid="day-cell"][tabindex="0"]')).toHaveClass(/sel/);
});

test('arrow keys past the last day cross into the next month', async ({ page }) => {
	await open(page);
	const heading = page.getByTestId('month-heading');
	const start = await heading.innerText();
	const lastIn = page.locator('[data-testid="day-cell"]:not(.out)').last();
	await lastIn.click();
	await lastIn.focus();
	// Day 28-31 may sit mid-row; Down from the last row crosses, so walk down.
	for (let i = 0; i < 6; i++) {
		await page.keyboard.press('ArrowDown');
		if ((await heading.innerText()) !== start) break;
	}
	await expect(heading).not.toHaveText(start);
	await settled(page);
	await expect(page.locator('[data-testid="day-cell"].sel')).toBeFocused();
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
	if (isPhone(page)) {
		await handleOf(page).click();
		expect(await check()).toEqual([]);
	}
});

test('on wide screens a dimmed day also slides to its month', async ({ page }, info) => {
	test.skip(!info.project.name.startsWith('desktop'), 'wide layout only');
	await open(page);
	const heading = page.getByTestId('month-heading');
	const start = await heading.innerText();
	const trailing = page.locator('[data-testid="day-cell"].out').last();
	const date = (await trailing.getAttribute('data-date'))!;
	await trailing.click();
	await expect(heading).not.toHaveText(start);
	await settled(page);
	await expect(page.locator('[data-testid="day-cell"].sel')).toHaveAttribute('data-date', date);
	await expect(page.getByRole('grid', { name: 'Month' })).toHaveCount(1);
	await expect(page.getByTestId('day-cell')).toHaveCount(42);
});

test.describe('phones', () => {
	// eslint-disable-next-line no-empty-pattern
	test.beforeEach(({}, info) => {
		test.skip(!info.project.name.startsWith('phone'), 'phone layout only');
	});

	for (const size of [
		{ width: 360, height: 640 },
		{ width: 390, height: 844 }
	]) {
		test(`the page is stationary at ${size.width}x${size.height}`, async ({ page }) => {
			await page.setViewportSize(size);
			await open(page);
			const m = await page.evaluate(() => ({
				doc: document.documentElement.scrollHeight,
				h: window.innerHeight,
				w: document.documentElement.scrollWidth - document.documentElement.clientWidth
			}));
			expect(m.doc).toBeLessThanOrEqual(m.h);
			expect(m.w).toBeLessThanOrEqual(0);
			// Grid, drawer head and tab bar sit in the viewport without overlapping.
			const grid = (await page.getByRole('grid', { name: 'Month' }).boundingBox())!;
			const drawer = (await handleOf(page).boundingBox())!;
			const tabs = (await page.getByRole('navigation', { name: 'Views' }).boundingBox())!;
			expect(grid.y + grid.height).toBeLessThanOrEqual(drawer.y + 1);
			expect(drawer.y).toBeLessThan(tabs.y);
			expect(grid.height).toBeGreaterThan(250);
			// The FAB doesn't cover the collapsed preview.
			const fab = (await page.getByRole('button', { name: 'New reminder' }).boundingBox())!;
			const preview = (await page.getByTestId('day-preview').boundingBox())!;
			expect(preview.x + preview.width).toBeLessThanOrEqual(fab.x + 1);
		});
	}

	test('the drawer expands and collapses by tap, keyboard and Escape', async ({ page }) => {
		await open(page);
		const handle = handleOf(page);
		const region = page.getByRole('region', { name: /\d/ });
		await expect(handle).toHaveAttribute('aria-expanded', 'false');
		await expect(handle).toHaveAttribute('aria-controls', 'day-list');
		const before = (await handle.boundingBox())!;
		await handle.click();
		await expect(handle).toHaveAttribute('aria-expanded', 'true');
		await expect(region).toBeVisible();
		await expect.poll(async () => (await handle.boundingBox())!.y).toBeLessThan(before.y - 100);
		await handle.click();
		await expect(handle).toHaveAttribute('aria-expanded', 'false');
		await handle.focus();
		await page.keyboard.press('Enter');
		await expect(handle).toHaveAttribute('aria-expanded', 'true');
		await page.keyboard.press('Escape');
		await expect(handle).toHaveAttribute('aria-expanded', 'false');
		await expect(handle).toBeFocused();
		await page.keyboard.press('Space');
		await expect(handle).toHaveAttribute('aria-expanded', 'true');
	});

	test('dragging the handle up expands and down collapses', async ({ page }) => {
		await open(page);
		const handle = handleOf(page);
		const box = (await handle.boundingBox())!;
		const x = box.x + 40;
		await page.mouse.move(x, box.y + 10);
		await page.mouse.down();
		await page.mouse.move(x, box.y - 60, { steps: 6 });
		await page.mouse.move(x, box.y - 160, { steps: 6 });
		await page.mouse.up();
		await expect(handle).toHaveAttribute('aria-expanded', 'true');
		await expect.poll(async () => (await handle.boundingBox())!.y).toBeLessThan(box.y - 100);
		await page.waitForTimeout(300); // let the 200 ms transition finish
		const up = (await handle.boundingBox())!;
		await page.mouse.move(x, up.y + 10);
		await page.mouse.down();
		await page.mouse.move(x, up.y + 80, { steps: 6 });
		await page.mouse.move(x, up.y + 200, { steps: 6 });
		await page.mouse.up();
		await expect(handle).toHaveAttribute('aria-expanded', 'false');
	});

	test('swiping up on the grid expands the drawer; down on the grid does nothing', async ({
		page
	}) => {
		await open(page);
		const handle = handleOf(page);
		const heading = page.getByTestId('month-heading');
		const start = await heading.innerText();
		const day = await page.getByTestId('day-heading').innerText();
		const grid = (await page.getByRole('grid', { name: 'Month' }).boundingBox())!;
		const x = grid.x + grid.width / 2;
		const vertical = async (from: number, to: number) => {
			await page.mouse.move(x, from);
			await page.mouse.down();
			await page.mouse.move(x + 3, (from + to) / 2, { steps: 5 });
			await page.mouse.move(x + 4, to, { steps: 5 });
			await page.mouse.up();
		};
		await vertical(grid.y + grid.height - 40, grid.y + grid.height - 240);
		await expect(handle).toHaveAttribute('aria-expanded', 'true');
		// Neither the month nor the selected day changed.
		await expect(heading).toHaveText(start);
		await expect(page.getByTestId('day-heading')).toHaveText(day);
		await page.keyboard.press('Escape');
		await expect(handle).toHaveAttribute('aria-expanded', 'false');
		await vertical(grid.y + 40, grid.y + 240);
		await expect(handle).toHaveAttribute('aria-expanded', 'false');
	});

	test('pulling the expanded list down from its top collapses the drawer', async ({ page }) => {
		await open(page);
		await expandIfPhone(page);
		await page.waitForTimeout(300); // let the 200 ms transition finish
		const list = (await page.locator('#day-list').boundingBox())!;
		const x = Math.round(list.x + list.width / 2);
		const y0 = Math.round(list.y + 20);
		const cdp = await page.context().newCDPSession(page);
		const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y?: number) =>
			cdp.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: y === undefined ? [] : [{ x, y }]
			});
		const pull = async () => {
			await touch('touchStart', y0);
			for (let i = 1; i <= 10; i++) await touch('touchMove', y0 + i * 25);
			await touch('touchEnd');
		};
		// Scrolled down, the same pull scrolls the list back instead.
		const listEl = page.locator('#day-list');
		await listEl.evaluate((el) => {
			const ul = el.querySelector('ul')!;
			const row = ul.firstElementChild!;
			for (let i = 0; i < 20; i++) ul.append(row.cloneNode(true));
			el.scrollTop = 120;
		});
		await pull();
		await page.waitForTimeout(300);
		await expect(handleOf(page)).toHaveAttribute('aria-expanded', 'true');
		await listEl.evaluate((el) => (el.scrollTop = 0));
		await pull();
		await expect(handleOf(page)).toHaveAttribute('aria-expanded', 'false');
	});

	test('the expanded list scrolls inside the drawer, with the FAB hidden', async ({ page }) => {
		await open(page);
		await expandIfPhone(page);
		const list = page.locator('#day-list');
		// Pad the list with copies of its rows so it overflows whatever the day holds.
		await list.evaluate((el) => {
			const ul = el.querySelector('ul')!;
			const row = ul.firstElementChild!;
			for (let i = 0; i < 20; i++) ul.append(row.cloneNode(true));
		});
		const m = await list.evaluate((el) => ({
			overflow: getComputedStyle(el).overflowY,
			scroll: el.scrollHeight,
			client: el.clientHeight
		}));
		expect(m.overflow).toBe('auto');
		expect(m.scroll).toBeGreaterThan(m.client);
		await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
		expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
		expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
			true
		);
		// The FAB is hidden while the drawer is expanded, so nothing covers the last row.
		await expect(page.getByRole('button', { name: 'New reminder' })).toBeHidden();
	});

	test('selecting another day keeps the drawer state and updates it', async ({ page }) => {
		await open(page);
		const heading = page.getByTestId('day-heading');
		const before = await heading.innerText();
		await page.locator('[data-testid="day-cell"][tabindex="0"]').focus();
		await page.keyboard.press('ArrowRight');
		await expect(heading).not.toHaveText(before);
		await expect(handleOf(page)).toHaveAttribute('aria-expanded', 'false');
		await handleOf(page).click();
		// Expanded: the month header stays usable and the day follows it.
		const open_ = await heading.innerText();
		await page.getByRole('button', { name: 'Next month' }).click();
		await expect(heading).not.toHaveText(open_);
		await expect(handleOf(page)).toHaveAttribute('aria-expanded', 'true');
	});

	test('tapping a dimmed day of the next month slides there and selects that date', async ({
		page
	}) => {
		await open(page);
		const monthHeading = page.getByTestId('month-heading');
		const start = await monthHeading.innerText();
		const trailing = page.locator('[data-testid="day-cell"].out').last();
		const date = (await trailing.getAttribute('data-date'))!;
		const label = (await trailing.getAttribute('aria-label'))!;
		const [, day, monthName] = /^\w+ (\d+) (\w+),/.exec(label)!;
		await trailing.click();
		await expect(monthHeading).not.toHaveText(start);
		await expect(monthHeading).toContainText(monthName!);
		const selected = page.locator('[data-testid="day-cell"].sel');
		await expect(selected).toHaveCount(1);
		await expect(selected).toHaveAttribute('data-date', date);
		await expect(selected).not.toHaveClass(/out/);
		await expect(page.getByTestId('day-heading')).toContainText(`${day} ${monthName}`);
		// Once the slide ends only the new month's grid remains.
		await expect(page.getByRole('grid', { name: 'Month' })).toHaveCount(1);
		await expect(page.getByTestId('day-cell')).toHaveCount(42);
	});

	test('swiping the grid left and right changes month', async ({ page }) => {
		await open(page);
		const heading = page.getByTestId('month-heading');
		const start = await heading.innerText();
		const grid = (await page.getByRole('grid', { name: 'Month' }).boundingBox())!;
		const y = grid.y + grid.height / 2;
		const swipe = async (from: number, to: number) => {
			await page.mouse.move(from, y);
			await page.mouse.down();
			await page.mouse.move((from + to) / 2, y + 4, { steps: 4 });
			await page.mouse.move(to, y + 6, { steps: 4 });
			await page.mouse.up();
		};
		await swipe(grid.x + grid.width - 30, grid.x + 30);
		await expect(heading).not.toHaveText(start);
		await expect(page.getByRole('grid', { name: 'Month' })).toHaveCount(1);
		await swipe(grid.x + 30, grid.x + grid.width - 30);
		await expect(heading).toHaveText(start);
	});

	test('with reduced motion months still change at once', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await open(page);
		const heading = page.getByTestId('month-heading');
		const start = await heading.innerText();
		await page.getByRole('button', { name: 'Next month' }).click();
		await expect(heading).not.toHaveText(start);
		await expect(page.getByTestId('day-cell')).toHaveCount(42);
		await handleOf(page).click();
		await expect(handleOf(page)).toHaveAttribute('aria-expanded', 'true');
	});
});

test.describe('desktop: the whole month fits without scrolling', () => {
	// eslint-disable-next-line no-empty-pattern
	test.beforeEach(({}, info) => {
		test.skip(!info.project.name.startsWith('desktop'), 'desktop layout only');
	});

	for (const size of [
		{ width: 1366, height: 860 },
		{ width: 1366, height: 768 },
		{ width: 1280, height: 720 }
	]) {
		test(`${size.width}x${size.height}: no vertical scroll, 42 cells visible, list in the panel`, async ({
			page
		}) => {
			await page.setViewportSize(size);
			await open(page);
			const m = await page.locator('main').evaluate((el) => ({
				scroll: el.scrollHeight,
				client: el.clientHeight
			}));
			expect(m.scroll).toBeLessThanOrEqual(m.client);
			for (const cell of await page.getByTestId('day-cell').all()) {
				const box = (await cell.boundingBox())!;
				expect(box.y).toBeGreaterThanOrEqual(0);
				expect(box.y + box.height).toBeLessThanOrEqual(size.height);
			}
			await expect(page.locator('aside.panel').getByTestId('day-heading')).toBeVisible();
			await expect(page.locator('aside.panel .list')).toBeVisible();
			// With the inspector hidden the list sits beside the grid, still without scrolling.
			await page.getByRole('button', { name: 'Hide inspector' }).click();
			await expect(page.getByRole('complementary', { name: 'Selected day' })).toBeVisible();
			await expect(page.getByTestId('day-heading')).toBeVisible();
			const over = await page.locator('main').evaluate((el) => el.scrollHeight - el.clientHeight);
			expect(over).toBeLessThanOrEqual(0);
			const results = await new AxeBuilder({ page }).analyze();
			const bad = results.violations.filter(
				(v) => v.impact === 'serious' || v.impact === 'critical'
			);
			expect(bad.map((v) => v.id)).toEqual([]);
		});
	}
});
