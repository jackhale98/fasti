// SPDX-License-Identifier: GPL-2.0-or-later
// Renders Fasti's PNG icons for the web manifest and the iOS Home Screen from
// the calendar glyph (the same drawing as static/favicon.svg). The "any" icons
// are the glyph on a paper tile; the maskable ones fill the square with the
// glyph inside the central safe zone, so Android can crop them to any shape.
//
//   node scripts/make-icons.mjs
//
// Adapted from Tessera's scripts/make-icons.mjs (MIT). Uses Playwright's Chromium.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const glyph = `<rect x="3" y="4" width="18" height="17" rx="3" fill="#ffffff" stroke="#1E5B49" stroke-width="1.8"/>
	<path d="M3 9h18" stroke="#1E5B49" stroke-width="1.8"/>
	<rect x="7" y="12.5" width="4" height="4" rx="1" fill="#F3D04A"/>`;
const tile = (scale, radius) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
	<rect width="24" height="24" rx="${radius}" fill="#F2F4F1"/>
	<g transform="translate(12 12.5) scale(${scale}) translate(-12 -12.5)">${glyph}</g>
</svg>`;

function findChromium() {
	if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
	const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (!dir || !existsSync(dir)) return undefined;
	for (const entry of readdirSync(dir).sort().reverse()) {
		if (!entry.startsWith('chromium-')) continue;
		for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
			if (existsSync(join(dir, entry, rel))) return join(dir, entry, rel);
		}
	}
	return undefined;
}

const icons = [
	// [file, size, glyph scale, corner radius]
	['icon-192.png', 192, 0.86, 5],
	['icon-512.png', 512, 0.86, 5],
	['icon-maskable-192.png', 192, 0.66, 0],
	['icon-maskable-512.png', 512, 0.66, 0],
	// iOS rounds the corners itself and shows no transparency.
	['apple-touch-icon.png', 180, 0.8, 0]
];

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage();
for (const [file, size, scale, radius] of icons) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${tile(scale, radius)}`
	);
	writeFileSync(
		join(root, 'static', file),
		await page.screenshot({ type: 'png', omitBackground: true })
	);
	console.log(`wrote static/${file}`);
}
await browser.close();
