// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Settings → Notifications: turning them on with the permission granted
 * (Playwright context permissions), the test notification, the message when
 * this build has no worker for push, iOS guidance, axe and 360 px.
 *
 * Notifications are recorded by a stand-in for the page's Notification
 * constructor (and the service worker registration's showNotification), so
 * nothing pops up on the machine running the tests.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

declare global {
	interface Window {
		__shown: { title: string; body?: string; tag?: string }[];
	}
}

/** Records notifications instead of showing them; `permission` overrides the browser's. */
async function recordNotifications(page: Page, permission?: NotificationPermission) {
	await page.addInitScript((forced) => {
		const Real = window.Notification;
		window.__shown = [];
		const current = () => (forced ?? Real.permission) as NotificationPermission;
		class Recorder extends EventTarget {
			onclick: ((event: Event) => void) | null = null;
			constructor(title: string, options: NotificationOptions = {}) {
				super();
				window.__shown.push({ title, body: options.body, tag: options.tag });
			}
			close() {}
			static get permission() {
				return current();
			}
			static requestPermission() {
				return forced ? Promise.resolve(forced) : Real.requestPermission();
			}
		}
		Object.defineProperty(window, 'Notification', { value: Recorder, configurable: true });
		if ('ServiceWorkerRegistration' in window) {
			ServiceWorkerRegistration.prototype.showNotification = async function (
				title: string,
				options: NotificationOptions = {}
			) {
				window.__shown.push({ title, body: options.body, tag: options.tag });
			};
		}
	}, permission ?? null);
}

async function seriousAxe(page: Page) {
	const results = await new AxeBuilder({ page }).analyze();
	return results.violations
		.filter((v) => v.impact === 'serious' || v.impact === 'critical')
		.map((v) => `${v.id}: ${v.help}`);
}

const section = (page: Page) => page.getByRole('region', { name: 'Notifications' });

test.describe('with permission granted', () => {
	test.beforeEach(async ({ context, page, baseURL }) => {
		await context.grantPermissions(['notifications'], { origin: baseURL });
		await recordNotifications(page);
	});

	test('turns on, says push isn’t set up, and sends a test notification', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.goto('/settings');
		const s = section(page);
		await expect(s.getByText('Notifications are off.')).toBeVisible();
		await expect(s.getByRole('button', { name: 'Send a test notification' })).toBeDisabled();
		// This build has no PUBLIC_WORKER_URL.
		await expect(s.getByTestId('push-not-configured')).toHaveText(
			'Push isn’t set up for this copy of Fasti, so notifications only work while Fasti is open.'
		);
		await expect(s.getByText('Battery savers, Focus and Low Power Mode can delay')).toBeVisible();

		await s.getByRole('button', { name: 'Turn on notifications' }).click();
		await expect(s.getByText('Notifications are on for this device.')).toBeVisible();
		// The count of today's timers comes from Remind's schedule.
		await expect(s.getByTestId('notify-status')).toHaveText(
			/^\d+ more notifications? today while Fasti is open\.$/
		);

		await s.getByRole('button', { name: 'Send a test notification' }).click();
		await expect(s.getByRole('status')).toHaveText('Test notification sent.');
		const shown = await page.evaluate(() => window.__shown);
		expect(shown).toContainEqual(
			expect.objectContaining({
				title: 'Fasti test notification',
				body: 'Notifications work on this device.'
			})
		);

		expect(await seriousAxe(page)).toEqual([]);

		// Stays on across a reload, and turns off.
		await page.reload();
		await expect(section(page).getByText('Notifications are on for this device.')).toBeVisible();
		await section(page).getByRole('button', { name: 'Turn off' }).click();
		await expect(section(page).getByText('Notifications are off.')).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('a timer shows a reminder due now, with the body Remind substituted', async ({ page }) => {
		await page.goto('/settings');
		await section(page).getByRole('button', { name: 'Turn on notifications' }).click();
		await expect(section(page).getByText('Notifications are on for this device.')).toBeVisible();
		// A reminder two minutes from now whose first warning (+2) is this minute.
		const at = await page.evaluate(() => {
			const d = new Date(Date.now() + 2 * 60_000);
			return { h: d.getHours(), m: d.getMinutes() };
		});
		test.skip(at.h === 0 && at.m < 3, 'too close to midnight');
		const hhmm = `${String(at.h).padStart(2, '0')}:${String(at.m).padStart(2, '0')}`;
		await page.evaluate(
			(line) =>
				new Promise<void>((resolve, reject) => {
					const open = indexedDB.open('fasti');
					open.onerror = () => reject(open.error);
					open.onsuccess = () => {
						const tx = open.result.transaction('files', 'readwrite');
						const store = tx.objectStore('files');
						const all = store.getAll();
						all.onsuccess = () => {
							const row = (all.result as { path: string; text: string }[]).find(
								(r) => r.path === 'reminders.rem'
							)!;
							store.put({ ...row, text: `${row.text}${line}\n`, dirty: true });
						};
						tx.oncomplete = () => {
							open.result.close();
							resolve();
						};
						tx.onerror = () => reject(tx.error);
					};
				}),
			`REM AT ${hhmm} +2 MSG Timer check %1`
		);
		await page.reload();
		await expect
			.poll(() => page.evaluate(() => window.__shown.map((n) => n.title)), { timeout: 15_000 })
			.toContainEqual(expect.stringMatching(/^Timer check (2 minutes from now|in 2 minutes)/));
	});

	test('fits a 360 px screen', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 740 });
		await page.goto('/settings');
		await section(page).getByRole('button', { name: 'Turn on notifications' }).click();
		await expect(section(page).getByText('Notifications are on for this device.')).toBeVisible();
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
		expect(await seriousAxe(page)).toEqual([]);
	});
});

test('explains when notifications are blocked', async ({ page }) => {
	await recordNotifications(page, 'denied');
	await page.goto('/settings');
	const s = section(page);
	await expect(s.getByText('Notifications are blocked for Fasti in this browser.')).toBeVisible();
	await expect(s.getByRole('button', { name: 'Turn on notifications' })).toBeDisabled();
	await expect(s.getByText('Allow notifications for this site')).toBeVisible();
	expect(await seriousAxe(page)).toEqual([]);
});

test.describe('in iPhone Safari outside the Home Screen', () => {
	test.use({
		userAgent:
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
	});

	test('explains adding Fasti to the Home Screen', async ({ page }) => {
		await page.goto('/settings');
		const guide = section(page).getByTestId('ios-guidance');
		await expect(guide).toContainText(
			'notifications work only when Fasti is added to the Home Screen'
		);
		await expect(guide.getByRole('listitem')).toHaveCount(3);
		await expect(guide).toContainText('Add to Home Screen');
		await expect(section(page).getByRole('button', { name: 'Turn on notifications' })).toHaveCount(
			0
		);
		expect(await seriousAxe(page)).toEqual([]);
	});
});
