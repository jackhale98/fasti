// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from '@playwright/test';

test('after one visit, every view works offline, engine included', async ({ page, context }) => {
	await page.goto('/');
	await expect(page.getByText(/^Reminders for /)).toBeVisible();
	// The worker registers once the page is idle and precaches everything before
	// it activates; `ready` resolves on activation. (waitForFunction needs a
	// synchronous predicate: an async one returns a Promise, which is truthy.)
	await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
	await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20_000 });
	await context.setOffline(true);
	await page.reload();
	// Remind runs from the cached remind.wasm: the banner is Remind's own text.
	await expect(page.getByText(/^Reminders for /)).toBeVisible();
	await expect(page.getByRole('status').filter({ hasText: 'Offline' })).toBeVisible();
	for (const [path, heading] of <[string, string][]>[
		['/month', 'Month'],
		['/script', 'Script'],
		['/settings', 'Settings']
	]) {
		await page.goto(path);
		await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
	}
	await context.setOffline(false);
});

test('the manifest describes an installable app', async ({ page, request }) => {
	await page.goto('/');
	const href = await page.locator('link[rel="manifest"]').getAttribute('href');
	expect(href).toBeTruthy();
	const manifest = await (await request.get(new URL(href!, page.url()).toString())).json();
	expect(manifest.name).toBe('Fasti');
	expect(manifest.display).toBe('standalone');
	const purposes = manifest.icons.map(
		(i: { purpose: string; sizes: string }) => `${i.purpose} ${i.sizes}`
	);
	expect(purposes).toEqual(
		expect.arrayContaining(['any 192x192', 'any 512x512', 'maskable 512x512'])
	);
	for (const icon of manifest.icons) {
		const response = await request.get(new URL(icon.src, new URL(href!, page.url())).toString());
		expect(response.status(), icon.src).toBe(200);
	}
});
