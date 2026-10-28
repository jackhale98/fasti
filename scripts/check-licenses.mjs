#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Fails when a package whose code ships in the site has a licence that isn't
 * compatible with GPLv2 (docs/PLAN.md section 11). Apache-2.0 alone is not:
 * a package under it must be replaced, or offer another licence (MIT OR Apache-2.0).
 *
 * "Ships" means has a module in the client build: the build writes that list
 * to .svelte-kit/shipped-packages.json (vite.config.ts), so run `npm run build`
 * first. Tools that only build or test the site never reach a visitor.
 *
 * Remind itself is not an npm package: it is vendored in engine/vendor/ and
 * runs as a separate program (THIRD_PARTY_NOTICES.md).
 *
 *   node scripts/check-licenses.mjs [--list]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHIPPED = '.svelte-kit/shipped-packages.json';

/** SPDX identifiers whose terms are compatible with GPL-2.0-or-later. */
export const ALLOWED = new Set([
	'MIT',
	'MIT-0',
	'ISC',
	'0BSD',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'Zlib',
	'Unlicense',
	'CC0-1.0',
	'MPL-2.0',
	'OFL-1.1',
	'GPL-2.0',
	'GPL-2.0-only',
	'GPL-2.0-or-later',
	'LGPL-2.1',
	'LGPL-2.1-only',
	'LGPL-2.1-or-later'
]);

/**
 * Whether an SPDX expression can be met with allowed licences: OR needs one
 * side, AND needs both, WITH takes its licence's verdict.
 * @param {string} expression
 * @returns {boolean}
 */
export function allowed(expression) {
	const tokens = expression.replace(/[()]/g, ' $& ').trim().split(/\s+/);
	let at = 0;
	/** @returns {boolean} */
	function or() {
		let ok = and();
		while (tokens[at]?.toUpperCase() === 'OR') {
			at++;
			ok = and() || ok;
		}
		return ok;
	}
	/** @returns {boolean} */
	function and() {
		let ok = term();
		while (tokens[at]?.toUpperCase() === 'AND') {
			at++;
			ok = term() && ok;
		}
		return ok;
	}
	/** @returns {boolean} */
	function term() {
		const token = tokens[at++];
		if (token === undefined) throw new Error(`incomplete licence expression: ${expression}`);
		let ok;
		if (token === '(') {
			ok = or();
			if (tokens[at++] !== ')') throw new Error(`unbalanced licence expression: ${expression}`);
		} else {
			ok = ALLOWED.has(token.replace(/\+$/, ''));
		}
		if (tokens[at]?.toUpperCase() === 'WITH') at += 2;
		return ok;
	}
	const ok = or();
	if (at !== tokens.length) throw new Error(`cannot read licence expression: ${expression}`);
	return ok;
}

/**
 * The licence a package declares, as an SPDX expression ('UNKNOWN' if none).
 * @param {{ license?: string | { type?: string }, licenses?: { type?: string }[] }} manifest package.json
 */
export function licenceOf(manifest) {
	const { license, licenses } = manifest;
	if (typeof license === 'string') return license;
	if (license?.type) return license.type;
	if (licenses?.length) return `(${licenses.map((l) => l.type ?? 'UNKNOWN').join(' OR ')})`;
	return 'UNKNOWN';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	let dirs;
	try {
		dirs = JSON.parse(readFileSync(SHIPPED, 'utf8'));
	} catch {
		console.error(`${SHIPPED} is missing: run \`npm run build\` first.`);
		process.exit(2);
	}
	// Svelte's runtime always ships, so an empty list means the build didn't record anything.
	if (!dirs.length) {
		console.error(`${SHIPPED} lists no packages: the build's package recording is broken.`);
		process.exit(2);
	}
	const list = process.argv.includes('--list');
	const bad = [];
	for (const dir of dirs) {
		const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
		const licence = licenceOf(manifest);
		let ok;
		try {
			ok = allowed(licence);
		} catch {
			ok = false;
		}
		const name = `${manifest.name}@${manifest.version}`;
		if (list) console.log(`${ok ? 'ok ' : 'BAD'} ${name} ${licence}`);
		if (!ok) bad.push(`${name}: ${licence}`);
	}
	if (bad.length) {
		console.error('Licences not compatible with GPL-2.0-or-later in shipped packages:');
		for (const line of bad) console.error(`  ${line}`);
		process.exit(1);
	}
	console.log(`${dirs.length} shipped packages: all licences are GPLv2-compatible.`);
}
