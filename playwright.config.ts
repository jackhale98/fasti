// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// PW_PORT lets several checkouts run their e2e suites side by side.
const PORT = Number(process.env.PW_PORT ?? 4173);

/**
 * Resolve a Chromium binary when the installed Playwright revision does not match the
 * preinstalled browsers. Order: PW_CHROMIUM_PATH env, then any chromium under
 * PLAYWRIGHT_BROWSERS_PATH, else undefined (Playwright's own default lookup, e.g. in CI).
 */
function findChromium(): string | undefined {
	const fromEnv = process.env.PW_CHROMIUM_PATH;
	if (fromEnv) return fromEnv;

	const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (!root || !existsSync(root)) return undefined;

	const candidates = ['chrome-linux64/chrome', 'chrome-linux/chrome'];
	for (const dir of readdirSync(root).sort().reverse()) {
		if (!dir.startsWith('chromium-')) continue;
		for (const rel of candidates) {
			const p = join(root, dir, rel);
			if (existsSync(p)) return p;
		}
	}
	return undefined;
}

const executablePath = process.env.CI ? process.env.PW_CHROMIUM_PATH : findChromium();
const launchOptions = executablePath ? { executablePath } : {};
// Without an explicit binary (CI), run the full Chromium in its new headless mode,
// not the slimmed "headless shell", which lacks parts of the Notification and
// service worker APIs that real browsers have.
const channel = executablePath ? {} : { channel: 'chromium' };

// docs/PLAN.md section 7: phone (390×844) and desktop (1366×860), each in light and dark.
export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry'
	},
	projects: [
		{
			name: 'phone-light',
			use: {
				...devices['Pixel 7'],
				viewport: { width: 390, height: 844 },
				colorScheme: 'light',
				launchOptions,
				...channel
			}
		},
		{
			name: 'phone-dark',
			use: {
				...devices['Pixel 7'],
				viewport: { width: 390, height: 844 },
				colorScheme: 'dark',
				launchOptions,
				...channel
			}
		},
		{
			name: 'desktop-light',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1366, height: 860 },
				colorScheme: 'light',
				launchOptions,
				...channel
			}
		},
		{
			name: 'desktop-dark',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1366, height: 860 },
				colorScheme: 'dark',
				launchOptions,
				...channel
			}
		}
	],
	webServer: {
		command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
		port: PORT,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
