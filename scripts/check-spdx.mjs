#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Fails when a source file has no SPDX-License-Identifier line near its top
 * (docs/PLAN.md section 11). Checks tracked and new files under the source
 * directories; vendored and reference material is left alone.
 *
 *   node scripts/check-spdx.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SOURCE = /\.(ts|js|mjs|cjs|svelte|css|sh)$/;
export const SKIP = /^(reference|engine\/vendor|engine\/patches|static\/engine)\//;

/**
 * Whether the text carries an SPDX identifier in its first five lines.
 * @param {string} text
 */
export function hasSpdx(text) {
	return /SPDX-License-Identifier:\s*\S+/.test(text.split('\n', 5).join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
		encoding: 'utf8'
	})
		.split('\n')
		.filter((f) => SOURCE.test(f) && !SKIP.test(f));
	const missing = files.filter((f) => {
		try {
			return !hasSpdx(readFileSync(f, 'utf8'));
		} catch {
			return false; // listed but deleted in the working tree
		}
	});
	if (missing.length) {
		console.error('Source files without an SPDX-License-Identifier line:');
		for (const f of missing) console.error(`  ${f}`);
		process.exit(1);
	}
	console.log(`SPDX headers present in ${files.length} source files.`);
}
